"""KPI Builder subagent (multihop) — guided mode only.

Reads the user's intent (from the interview) plus the cleaned/merged warehouse
tables, then reasons about which DERIVED KPI columns answer that intent and
materialises them into an `auto_kpi_*` warehouse table: rolling N-month averages
(window functions), cost/revenue ratios, and a `performance_category`
(performing vs underperforming) via CASE. The resulting table is added to the
analysis targets so the lenses + visualization phases chart the user's KPIs.

Reuses the same DROP-then-CREATE `materialize_table` machinery as cleaning.py and
merging.py — no new DDL path. If the agent materialises nothing, state is left
untouched and the pipeline proceeds on the existing tables.
"""
from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field

from ...db.introspection import warehouse_tables_with_columns
from ...db.schemas import list_warehouse_tables
from .auto_tools import (
    make_list_warehouse_tool,
    make_materialize_tool,
    make_profile_tool,
    make_read_sql_tool,
)
from ._run import make_submit_tool, run_subagent

log = logging.getLogger("agents.auto_pipeline")
NAME = "auto-kpi-builder"


class KpiColumn(BaseModel):
    name: str = Field(description="Derived column name created, e.g. 'rolling_3mo_revenue'.")
    description: str = Field(default="", description="What it measures and how it is computed.")


class KpiResult(BaseModel):
    summary: str = Field(description="2-3 sentence summary of the KPIs built and how they answer the user's intent.")
    table: str = Field(default="", description="The auto_kpi_* table that holds the derived KPI columns.")
    columns: list[KpiColumn] = Field(default_factory=list)
    categorization: str = Field(
        default="", description="The rule used to label entities performing vs underperforming."
    )


def _schema_context(tables: list[dict[str, Any]], targets: list[str]) -> str:
    chosen = [t for t in tables if t["tableName"] in targets] or tables
    lines = ["WAREHOUSE TABLES you may read (cleaned + merged):"]
    for t in chosen:
        cols = ", ".join(f'{c["name"]} {c["type"]}' for c in t["columns"][:30])
        lines.append(f'- "{t["tableName"]}": {cols}')
    return "\n".join(lines)


def _build_prompt(schema_ctx: str, user_intent: str) -> str:
    lines = [
        "You are the KPI Builder agent in a guided BI pipeline. Reason in multiple hops.",
        "Your job is to turn the user's intent into concrete, queryable KPI columns the dashboard can chart.",
        "",
        schema_ctx,
        "",
    ]
    if user_intent:
        lines += [user_intent, ""]
    else:
        lines += ["No explicit user intent was given — build the KPIs that best characterise performance.", ""]
    lines += [
        "YOUR JOB:",
        "1. Optionally run_sql / profile_table to understand grain, the entity key, the date column and the",
        "   revenue/cost columns. Keep it to a few well-chosen queries.",
        "2. Decide the KPIs that answer the intent. Typically:",
        "   - rolling N-month averages of the key metric using a window function (the user picked the window),",
        "   - ratios such as revenue vs maintenance/other cost,",
        "   - a performance_category column via CASE (e.g. 'underperforming' when cost exceeds revenue or the",
        "     metric is below the cohort average), else 'performing'.",
        "3. Call materialize_table(target_table='auto_kpi_<entity>', select_sql=<a SELECT that produces ONE row",
        "   per entity (or per entity+period) with the raw key columns PLUS the derived KPI columns above>).",
        "   The tool writes the CREATE for you; the SELECT must be fully-qualified and SELECT-only.",
        "4. Call submit_kpis ONCE with the table name, the derived columns, and the categorization rule. Then stop.",
    ]
    return "\n".join(lines)


async def run_kpi_builder(state: dict[str, Any]) -> dict[str, Any]:
    project_id = state["project_id"]
    merge = dict(state.get("merge") or {})
    targets = merge.get("analysisTargets") or []
    user_intent = state.get("user_intent") or ""

    try:
        tables = await warehouse_tables_with_columns(project_id)
    except Exception:  # noqa: BLE001
        tables = []
    schema_ctx = _schema_context(tables, targets)

    wh_before = {str(t["tableName"]) for t in await list_warehouse_tables(project_id)}

    holder: dict[str, Any] = {}
    tools = [
        make_read_sql_tool(project_id, include_raw=False),
        make_list_warehouse_tool(project_id),
        make_profile_tool(project_id, layer="warehouse"),
        make_materialize_tool(project_id),
        make_submit_tool(
            name="submit_kpis",
            description="Hand back the KPI build summary, the auto_kpi_* table, its derived columns and the "
                        "categorization rule. Call once at the end.",
            model=KpiResult, holder=holder,
        ),
    ]
    await run_subagent(
        name=NAME, project_id=project_id, system_prompt=_build_prompt(schema_ctx, user_intent),
        user_message="Build the KPI table that answers the user's intent, then call submit_kpis.",
        tools=tools, max_iterations=16, max_tokens=4096,
    )

    wh_after = {str(t["tableName"]) for t in await list_warehouse_tables(project_id)}
    new_kpi_tables = sorted(t for t in (wh_after - wh_before) if t.startswith("auto_kpi"))
    all_kpi_tables = sorted(t for t in wh_after if t.startswith("auto_kpi"))

    # Pick the KPI table to chart. `materialize_table` is DROP-then-CREATE, so on
    # a re-run the table already exists and (wh_after - wh_before) is empty — the
    # new-table diff alone would miss it and the KPI would never be prioritised.
    # Prefer the table the agent named (if it's a real auto_kpi_* table now in the
    # warehouse), then any freshly created one, then any pre-existing auto_kpi_*.
    submitted = holder.get("table")
    kpi_table = (
        submitted if submitted in wh_after and str(submitted).startswith("auto_kpi")
        else (new_kpi_tables[-1] if new_kpi_tables else (all_kpi_tables[-1] if all_kpi_tables else None))
    )

    if not kpi_table:
        # Nothing materialised — leave merge/targets untouched so the pipeline
        # falls back to the cleaned/merged tables.
        if holder:
            holder.setdefault("summary", "No KPI table produced; analysing existing tables.")
            return {"kpis": holder}
        return {}

    holder["table"] = kpi_table
    holder.setdefault("summary", "Built derived KPI columns.")

    # Make the analysis + visualization phases read the KPI table first.
    merge["analysisTargets"] = [kpi_table, *[t for t in targets if t != kpi_table]]
    return {"kpis": holder, "merge": merge}
