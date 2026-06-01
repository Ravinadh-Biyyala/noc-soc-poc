"""Data Visualization subagent.

Knows the visuals catalog (which chart fits which data shape) and turns the
analysis findings into concrete chart specs. Each chart carries its SQL + the
queried rows + xKey/yKey so the dashboard renderer can draw it. Chart specs are
later passed through the shared `normalize_agent_charts` in create_project_dashboard.
"""
from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field

from ...db.introspection import execute_warehouse_query, warehouse_tables_with_columns
from ...db.schemas import quote_ident, warehouse_schema
from .auto_tools import make_catalog_tool, make_warehouse_query_tool
from .catalog import catalog_digest, supported_chart_types
from ._run import make_submit_tool, run_subagent

log = logging.getLogger("agents.auto_pipeline")
NAME = "auto-visualization"


class ChartSpec(BaseModel):
    title: str
    chartType: str = Field(description="MUST be one of the supported dashboardChartType values from the catalog.")
    config: dict[str, Any] = Field(
        description="MUST include sql (the SELECT used) and data (the rows). For non-KPI charts also include "
                    "xKey (categorical) and yKey (numeric, or a list for multi-series)."
    )


class VisualizationResult(BaseModel):
    charts: list[ChartSpec] = Field(default_factory=list)


def _findings_digest(findings: dict[str, Any]) -> str:
    lines = []
    for lens, f in (findings or {}).items():
        lines.append(f"[{lens}] {f.get('summary', '')}")
        for kf in (f.get("keyFindings") or [])[:4]:
            lines.append(f"   • {kf}")
    return "\n".join(lines) or "(no findings)"


def _build_prompt(project_name: str, schema_ctx: str, findings: dict[str, Any]) -> str:
    return "\n".join([
        "You are the Data Visualization agent in an autonomous BI pipeline.",
        f'PROJECT: "{project_name}".',
        "",
        schema_ctx,
        "",
        "ANALYSIS FINDINGS to visualise:",
        _findings_digest(findings),
        "",
        "SUPPORTED CHART TYPES (pick chartType from the FIRST token of each line):",
        catalog_digest(),
        "",
        "YOUR JOB:",
        "1. For each important finding, pick the BEST chart type for its data shape (use get_visuals_catalog if unsure).",
        "2. Write the SELECT that produces that chart's data and run it with run_sql to get the rows.",
        "3. Build 5-8 charts total. Each chart config MUST include: sql (the exact SELECT), data (the returned rows),",
        "   xKey (categorical column) and yKey (numeric column, or list for multi-series).",
        "4. Do NOT emit 'kpi' cards — those are generated automatically.",
        "5. Call submit_charts ONCE with all charts. Then stop.",
    ])


async def _fallback_chart(project_id: int, targets: list[str]) -> list[dict[str, Any]]:
    """Guarantee at least one chart so the dashboard can be created."""
    if not targets:
        return []
    wh = warehouse_schema(project_id)
    table = targets[0]
    sql = f'SELECT * FROM {quote_ident(wh)}.{quote_ident(table)} LIMIT 50'
    try:
        res = await execute_warehouse_query(project_id, sql)
        return [{
            "title": f"{table} (sample)",
            "chartType": "table",
            "config": {"sql": sql, "data": res["rows"]},
        }]
    except Exception as err:  # noqa: BLE001
        log.warning("fallback chart failed project=%s err=%s", project_id, err)
        return []


async def run_visualization(state: dict[str, Any]) -> dict[str, Any]:
    project_id = state["project_id"]
    merge = state.get("merge") or {}
    targets = merge.get("analysisTargets") or []
    findings = state.get("findings") or {}

    try:
        tables = await warehouse_tables_with_columns(project_id)
    except Exception:  # noqa: BLE001
        tables = []
    chosen = [t for t in tables if t["tableName"] in targets] or tables
    schema_lines = ["WAREHOUSE TABLES you may query:"]
    for t in chosen:
        cols = ", ".join(f'{c["name"]} {c["type"]}' for c in t["columns"][:30])
        schema_lines.append(f'- "{t["tableName"]}": {cols}')
    schema_ctx = "\n".join(schema_lines)

    holder: dict[str, Any] = {}
    supported = set(supported_chart_types())
    tools = [
        make_warehouse_query_tool(project_id),
        make_catalog_tool(),
        make_submit_tool(
            name="submit_charts",
            description="Hand back all chart specs for the dashboard. Call once at the end.",
            model=VisualizationResult, holder=holder,
        ),
    ]
    await run_subagent(
        name=NAME, project_id=project_id,
        system_prompt=_build_prompt(state.get("project_name", ""), schema_ctx, findings),
        user_message="Design 5-6 charts, fetch each chart's data with one run_sql call, then call submit_charts.",
        tools=tools, max_iterations=20, max_tokens=6000,
    )

    charts = holder.get("charts") or []
    # Keep only supported chart types; drop anything malformed.
    clean: list[dict[str, Any]] = []
    for c in charts:
        ct = (c.get("chartType") or "").strip()
        if ct in supported and isinstance(c.get("config"), dict):
            clean.append({"title": c.get("title") or ct, "chartType": ct, "config": c["config"]})

    if not clean:
        clean = await _fallback_chart(project_id, targets)

    return {"charts": clean}
