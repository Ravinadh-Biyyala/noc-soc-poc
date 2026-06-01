"""Data Engineer tools — LangChain port of `data-engineer/{tools,executor}.ts`.

A factory closes over `project_id` (the TS code did this with
`makeDataEngineerExecutor`). Each tool returns a JSON string, runs its validator
before any write, and mirrors the original OpenAI tool schema 1:1.
"""
from __future__ import annotations

import logging
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from ...db import pool as db
from ...db.introspection import columns_for_table
from ...db.repositories import transformations as repo
from ...db.schemas import quote_ident, raw_schema, warehouse_schema
from ..shared.serde import dumps
from ..shared.validation import (
    SqlValidationError,
    assert_transformation_sql,
    ddl_kind_for_transformation,
    normalize_transformation_ddl,
)
from .apply import apply_transformation

log = logging.getLogger("agents.data_engineer")

_NON_COMPARABLE = ("json", "jsonb", "xml")


async def _get_schema_info(project_id: int, table_name: str) -> dict[str, Any]:
    schema = raw_schema(project_id)
    cols = await columns_for_table(schema, table_name)
    if not cols:
        return {"error": f"Table {schema}.{table_name} not found."}
    return {"tableName": table_name, "schema": schema, "columns": cols}


async def _profile_data(project_id: int, table_name: str) -> dict[str, Any]:
    schema = raw_schema(project_id)
    qualified = f"{quote_ident(schema)}.{quote_ident(table_name)}"

    cols = await db.fetch_all(
        """
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s
        ORDER BY ordinal_position
        """,
        [schema, table_name],
    )
    if not cols:
        return {"error": f"Table {schema}.{table_name} not found."}

    count_row = await db.fetch_one(f"SELECT COUNT(*)::text AS count FROM {qualified}")
    row_count = int(count_row["count"]) if count_row else 0

    sample_rows = await db.fetch_all(f"SELECT * FROM {qualified} LIMIT 5")

    profile_parts: list[str] = []
    for i, c in enumerate(cols[:12]):
        col = quote_ident(c["column_name"])
        comparable = not any(t in c["data_type"].lower() for t in _NON_COMPARABLE)
        min_max = (
            f"MIN({col})::text AS min{i}, MAX({col})::text AS max{i}"
            if comparable
            else f"NULL::text AS min{i}, NULL::text AS max{i}"
        )
        profile_parts.append(
            f"COUNT(*) FILTER (WHERE {col} IS NULL) AS n{i}, "
            f"COUNT(DISTINCT {col}) AS d{i}, {min_max}"
        )

    profile_row: dict[str, Any] = {}
    if profile_parts:
        pr = await db.fetch_one(f"SELECT {', '.join(profile_parts)} FROM {qualified}")
        profile_row = pr or {}

    columns: list[dict[str, Any]] = []
    for i, c in enumerate(cols):
        profiled = i < 12
        sample = [r.get(c["column_name"]) for r in sample_rows][:3]
        columns.append(
            {
                "name": c["column_name"],
                "type": c["data_type"],
                "nullable": c["is_nullable"] == "YES",
                "nullCount": int(profile_row.get(f"n{i}", 0)) if profiled else None,
                "distinctCount": int(profile_row.get(f"d{i}", 0)) if profiled else None,
                "min": profile_row.get(f"min{i}") if profiled else None,
                "max": profile_row.get(f"max{i}") if profiled else None,
                "sample": sample,
            }
        )

    return {"tableName": table_name, "schema": schema, "rowCount": row_count,
            "columns": columns, "sampleRows": sample_rows}


async def _propose_transformation(project_id: int, args: "ProposeCleaningArgs") -> dict[str, Any]:
    warehouse = warehouse_schema(project_id)
    expected_ddl = ddl_kind_for_transformation(args.kind)
    normalized_sql = normalize_transformation_ddl(args.sql, expected_ddl)
    try:
        assert_transformation_sql(normalized_sql, warehouse, expected_ddl)
    except SqlValidationError as err:
        return {"error": str(err)}

    row = await repo.insert_proposal(
        project_id,
        kind=args.kind,
        title=args.title,
        description=args.description,
        source_tables=args.sourceTables,
        sql=normalized_sql,
        target_table_name=args.targetTableName,
        agent_rationale=args.rationale,
    )
    return {"id": row["id"], "status": row["status"]}


# --- Pydantic arg schemas (mirror DATA_ENGINEER_OPENAI_TOOLS) ---

class TableNameArgs(BaseModel):
    tableName: str = Field(description="Table name within the project's raw schema. No schema prefix.")


class ProposeCleaningArgs(BaseModel):
    kind: str = Field(description="One of: cleanse, join, aggregate, view, rename.")
    title: str = Field(description="Short human-readable title shown in the UI card.")
    description: str = Field(description="1–2 sentences the user can read to decide whether to accept.")
    sourceTables: list[str] = Field(description="Raw or warehouse tables this transformation reads from.")
    sql: str = Field(description="Full SQL — must start with CREATE [OR REPLACE] VIEW / TABLE in the project warehouse schema.")
    targetTableName: str = Field(description="Name of the new view/table in the warehouse.")
    rationale: str = Field(description="Why this transformation helps the project's stated goal.")


class ExecuteTransformationArgs(BaseModel):
    transformationId: int = Field(description="id of the row in project_transformations.")


def make_data_engineer_tools(project_id: int) -> list[StructuredTool]:
    async def get_schema_info(tableName: str) -> str:
        log.info("data-engineer tool get_schema_info project=%s table=%s", project_id, tableName)
        return dumps(await _get_schema_info(project_id, tableName))

    async def profile_data(tableName: str) -> str:
        log.info("data-engineer tool profile_data project=%s table=%s", project_id, tableName)
        return dumps(await _profile_data(project_id, tableName))

    async def propose_cleaning(**kwargs: Any) -> str:
        log.info("data-engineer tool propose_cleaning project=%s title=%s", project_id, kwargs.get("title"))
        return dumps(await _propose_transformation(project_id, ProposeCleaningArgs(**kwargs)))

    async def execute_transformation(transformationId: int) -> str:
        log.info("data-engineer tool execute_transformation project=%s tid=%s", project_id, transformationId)
        return dumps(await apply_transformation(project_id, transformationId))

    return [
        StructuredTool.from_function(
            coroutine=get_schema_info, name="get_schema_info", args_schema=TableNameArgs,
            description=("Return column names, types, and nullability for a raw table via "
                         "information_schema. Fast and cheap — call before profile_data."),
        ),
        StructuredTool.from_function(
            coroutine=profile_data, name="profile_data", args_schema=TableNameArgs,
            description=("Profile a raw table: row count, per-column null counts, distinct counts, "
                         "min/max, and 5 sample rows."),
        ),
        StructuredTool.from_function(
            coroutine=propose_cleaning, name="propose_cleaning", args_schema=ProposeCleaningArgs,
            description=("Record a cleaning / join / aggregation proposal the user can later accept. "
                         "Does NOT execute SQL — user review gates execution."),
        ),
        StructuredTool.from_function(
            coroutine=execute_transformation, name="execute_transformation",
            args_schema=ExecuteTransformationArgs,
            description=("Execute the SQL of an accepted transformation against the project's "
                         "warehouse schema."),
        ),
    ]
