"""Data Cleaning subagent (multihop).

Takes the raw schema from the profiler and produces cleansed `auto_clean_*`
tables in the warehouse: type casts, trimmed/standardised text, null handling,
and outlier filtering. Reuses the same DROP-then-CREATE machinery the manual
data-engineer uses, minus the propose/accept gate.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from ...db.schemas import list_warehouse_tables, quote_ident, raw_schema, warehouse_schema
from .auto_tools import make_materialize_tool, make_profile_tool, make_read_sql_tool, materialize
from ._run import make_submit_tool, run_subagent

NAME = "auto-cleaning"


class CleanedTable(BaseModel):
    source: str = Field(description="Source raw table name.")
    target: str = Field(description="Cleaned warehouse table name created (auto_*).")
    note: str = Field(default="", description="What was cleaned (casts, nulls, outliers).")


class CleaningResult(BaseModel):
    summary: str = Field(description="2-3 sentence summary of the cleaning performed.")
    tables: list[CleanedTable] = Field(default_factory=list)


def _build_prompt(project_id: int, profile: dict[str, Any]) -> str:
    raw = raw_schema(project_id)
    wh = warehouse_schema(project_id)
    lines = [
        "You are the Data Cleaning agent in an autonomous BI pipeline. Reason in multiple hops.",
        f'RAW schema: "{raw}"   WAREHOUSE schema (your output): "{wh}"',
        "",
        "RAW TABLES:",
    ]
    for t in profile.get("rawTables", []):
        cols = ", ".join(f'{c["name"]} {c["type"]}' for c in t["columns"][:24])
        lines.append(f'- "{t["tableName"]}": {cols}')
    lines.extend([
        "",
        "PROFILER SUMMARY: " + (profile.get("summary") or ""),
        "",
        "YOUR JOB — for EACH meaningful raw table:",
        "1. Optionally run_sql to inspect distinct values / suspect rows.",
        f'2. Call materialize_table(target_table, select_sql) where select_sql is a SELECT reading from "{raw}".',
        "   In the SELECT: cast numeric/date columns to proper types, TRIM/standardise text, coalesce or filter",
        "   nulls in key columns, and drop obvious outliers (e.g. negative amounts, impossible dates).",
        "   Name targets like 'auto_clean_<table>'. The tool DROP-then-CREATEs the warehouse table for you.",
        "3. After all tables are cleaned, call submit_cleaning ONCE with one entry per table. Then stop.",
        "Keep SELECTs fully-qualified and SELECT-only. Do NOT write CREATE yourself — materialize_table does that.",
    ])
    return "\n".join(lines)


async def _fallback_passthrough(project_id: int, profile: dict[str, Any]) -> list[dict[str, str]]:
    """If the agent created no warehouse tables, copy each raw table verbatim so
    downstream phases have something to work with."""
    raw = raw_schema(project_id)
    created: list[dict[str, str]] = []
    for t in profile.get("rawTables", []):
        name = str(t["tableName"])
        select = f'SELECT * FROM {quote_ident(raw)}.{quote_ident(name)}'
        res = await materialize(project_id, f"clean_{name}", select, "table")
        if "error" not in res:
            created.append({"source": name, "target": res["table"], "note": "passthrough copy (no cleaning rules applied)"})
    return created


async def run_cleaning(state: dict[str, Any]) -> dict[str, Any]:
    project_id = state["project_id"]
    profile = state.get("profile") or {}

    holder: dict[str, Any] = {}
    tools = [
        make_read_sql_tool(project_id, include_raw=True),
        make_profile_tool(project_id, layer="raw"),
        make_materialize_tool(project_id),
        make_submit_tool(
            name="submit_cleaning",
            description="Hand back the cleaning summary and the list of cleaned tables. Call once at the end.",
            model=CleaningResult, holder=holder,
        ),
    ]
    system_prompt = _build_prompt(project_id, profile)
    await run_subagent(
        name=NAME, project_id=project_id, system_prompt=system_prompt,
        user_message="Clean every meaningful raw table, then call submit_cleaning.",
        tools=tools, max_iterations=14, max_tokens=4096,
    )

    wh_tables = [t["tableName"] for t in await list_warehouse_tables(project_id)]
    auto_tables = [t for t in wh_tables if str(t).startswith("auto_")]

    errors: list[str] = []
    if not auto_tables:
        fallback = await _fallback_passthrough(project_id, profile)
        holder = {
            "summary": holder.get("summary") or "Cleaning agent produced no tables; copied raw tables verbatim.",
            "tables": fallback,
        }
        if not fallback:
            errors.append("cleaning: warehouse is empty after cleaning phase")

    holder.setdefault("summary", "Cleaning complete.")
    holder.setdefault("tables", [])
    holder["warehouseTables"] = [t for t in wh_tables if str(t).startswith("auto_")] or wh_tables

    delta: dict[str, Any] = {"cleaned": holder}
    if errors:
        delta["errors"] = errors
    return delta
