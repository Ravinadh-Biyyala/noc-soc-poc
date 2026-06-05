"""Data Visualization subagent.

Knows the visuals catalog (which chart fits which data shape) and turns the
analysis findings into concrete chart specs. Each chart carries its SQL + the
queried rows + xKey/yKey so the dashboard renderer can draw it. Chart specs are
later passed through the shared `normalize_agent_charts` in create_project_dashboard.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from pydantic import BaseModel, Field

from ...db.introspection import execute_warehouse_query, warehouse_tables_with_columns
from ...db.schemas import quote_ident, warehouse_schema
from ..data_modeler.dashboards import (
    BOOL_TYPE,
    CAT_KEYWORD,
    NUM_KEYWORD,
    NUMERIC_TYPE,
    PERF_KEYWORD,
    _col_to_label,
)
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
                    "xKey (categorical) and yKey (numeric, or a list for multi-series). ALSO include colors: "
                    "an array of hex color strings YOU choose to suit this chart (distinct professional hues for "
                    "categorical comparisons; a single hue for a single series; red/green only where it carries "
                    "good/bad meaning)."
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


def _build_prompt(project_name: str, schema_ctx: str, findings: dict[str, Any], user_intent: str | None = None) -> str:
    lines = [
        "You are the Data Visualization agent in an autonomous BI pipeline.",
        f'PROJECT: "{project_name}".',
        "",
    ]
    if user_intent:
        lines += [user_intent, ""]
    lines += [
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
    ]
    if user_intent:
        lines.append("   Prioritise charts that directly answer the user's questions (e.g. performing vs underperforming).")
    lines += [
        "2. Write the SELECT that produces that chart's data and run it with run_sql to get the rows.",
        "3. Build 5-8 charts total. Each chart config MUST include: sql (the exact SELECT), data (the returned rows),",
        "   xKey (categorical column) and yKey (numeric column, or list for multi-series), and colors",
        "   (an array of hex codes YOU choose that fit the chart — a coherent, professional palette; distinct hues",
        "   for categorical comparisons, a single hue for a single series; reserve red/green for good/bad meaning).",
        "4. Do NOT emit 'kpi' cards — those are generated automatically.",
        "5. Call submit_charts ONCE with all charts. Then stop.",
    ]
    return "\n".join(lines)


async def _aggregate_chart(
    project_id: int, table: str, columns: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """Build ONE real GROUP BY bar chart for a target table by picking a
    performance/category dimension and a meaningful numeric measure with the
    same heuristics the KPI synthesiser uses. Returns None if the table has no
    chartable category column."""
    numeric = [c["name"] for c in columns if NUMERIC_TYPE.search(c["type"])]
    categorical = [
        c["name"] for c in columns
        if not NUMERIC_TYPE.search(c["type"]) and not BOOL_TYPE.search(c["type"])
    ]
    cat = (
        next((c for c in categorical if PERF_KEYWORD.search(c)), None)
        or next((c for c in categorical if CAT_KEYWORD.search(c)), None)
        or (categorical[0] if categorical else None)
    )
    if not cat:
        return None
    num = next((c for c in numeric if NUM_KEYWORD.search(c)), None) or (numeric[0] if numeric else None)

    wh = warehouse_schema(project_id)
    qtable = f"{quote_ident(wh)}.{quote_ident(table)}"
    if num:
        sql = (
            f"SELECT {quote_ident(cat)}, ROUND(AVG({quote_ident(num)})::numeric, 2) AS avg_value "
            f"FROM {qtable} GROUP BY {quote_ident(cat)} ORDER BY 2 DESC LIMIT 20"
        )
        y_key, title = "avg_value", f"Avg {_col_to_label(num)} by {_col_to_label(cat)}"
    else:
        sql = (
            f"SELECT {quote_ident(cat)}, COUNT(*) AS record_count "
            f"FROM {qtable} GROUP BY {quote_ident(cat)} ORDER BY 2 DESC LIMIT 20"
        )
        y_key, title = "record_count", f"{_col_to_label(cat)} Distribution"
    try:
        res = await execute_warehouse_query(project_id, sql)
    except Exception as err:  # noqa: BLE001
        log.warning("fallback aggregate failed project=%s table=%s err=%s", project_id, table, err)
        return None
    rows = res.get("rows") or []
    if not rows:
        return None
    return {"title": title, "chartType": "bar", "config": {"sql": sql, "data": rows, "xKey": cat, "yKey": y_key}}


async def _fallback_chart(
    project_id: int, targets: list[str], tables: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Guarantee real charts so the dashboard reflects the analysis even when the
    viz agent submitted nothing usable. Builds aggregate bar charts off the first
    targets (KPI table first, since kpi_builder prioritised it), and only as a
    last resort falls back to a raw sample table."""
    if not targets:
        return []
    cols_by_table = {t["tableName"]: t.get("columns") or [] for t in tables}
    out: list[dict[str, Any]] = []
    for table in targets[:2]:
        chart = await _aggregate_chart(project_id, table, cols_by_table.get(table) or [])
        if chart:
            out.append(chart)
    if out:
        return out

    # Last resort: a raw sample so a dashboard can still be created.
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


async def _try_chart(
    project_id: int,
    sql: str,
    title: str,
    chart_type: str,
    x_key: str,
    y_key: str,
) -> "dict[str, Any] | None":
    """Execute SQL and return a chart dict if rows are returned, else None."""
    try:
        res = await execute_warehouse_query(project_id, sql)
        rows = res.get("rows") or []
        if not rows:
            return None
        return {"title": title, "chartType": chart_type, "config": {"sql": sql, "data": rows, "xKey": x_key, "yKey": y_key}}
    except Exception as err:  # noqa: BLE001
        log.warning("programmatic chart failed project=%s title=%s err=%s", project_id, title, err)
        return None


async def _supplement_charts(
    project_id: int,
    targets: list[str],
    tables: list[dict[str, Any]],
    exclude_titles: set[str],
    needed: int,
) -> list[dict[str, Any]]:
    """Generate diverse programmatic charts to fill up to `needed` slots.

    Produces up to 3 chart types per table — bar (avg numeric by category),
    pie (count distribution), and line/bar (time trend or second dimension).
    Skips titles already in `exclude_titles` to avoid duplicating LLM charts.
    """
    cols_by_table = {t["tableName"]: t.get("columns") or [] for t in tables}
    active = targets if targets else [t["tableName"] for t in tables]
    wh = warehouse_schema(project_id)
    out: list[dict[str, Any]] = []

    for table in active[:4]:
        if len(out) >= needed:
            break
        cols = cols_by_table.get(table) or []
        numeric = [c["name"] for c in cols if NUMERIC_TYPE.search(c["type"])]
        categorical = [
            c["name"] for c in cols
            if not NUMERIC_TYPE.search(c["type"]) and not BOOL_TYPE.search(c["type"])
        ]
        date_cols = [c for c in categorical if re.search(r"date|year|month|quarter|week|period|time", c, re.I)]
        cat = (
            next((c for c in categorical if PERF_KEYWORD.search(c)), None)
            or next((c for c in categorical if CAT_KEYWORD.search(c)), None)
            or (categorical[0] if categorical else None)
        )
        cat2 = next((c for c in categorical if c != cat), None) if cat else (categorical[0] if categorical else None)
        num = next((c for c in numeric if NUM_KEYWORD.search(c)), None) or (numeric[0] if numeric else None)
        qtable = f"{quote_ident(wh)}.{quote_ident(table)}"

        # Bar: avg numeric by primary category
        if cat and num and len(out) < needed:
            title = f"Avg {_col_to_label(num)} by {_col_to_label(cat)}"
            if title not in exclude_titles:
                sql = (
                    f"SELECT {quote_ident(cat)}, ROUND(AVG({quote_ident(num)})::numeric, 2) AS avg_value "
                    f"FROM {qtable} GROUP BY {quote_ident(cat)} ORDER BY 2 DESC LIMIT 15"
                )
                chart = await _try_chart(project_id, sql, title, "bar", cat, "avg_value")
                if chart:
                    out.append(chart)
                    exclude_titles.add(title)

        # Pie: count distribution by primary category
        if cat and len(out) < needed:
            title = f"{_col_to_label(cat)} Distribution"
            if title not in exclude_titles:
                sql = (
                    f"SELECT {quote_ident(cat)}, COUNT(*) AS record_count "
                    f"FROM {qtable} GROUP BY {quote_ident(cat)} ORDER BY 2 DESC LIMIT 8"
                )
                chart = await _try_chart(project_id, sql, title, "pie", cat, "record_count")
                if chart:
                    out.append(chart)
                    exclude_titles.add(title)

        # Line trend (date col) or second-dimension bar
        if len(out) < needed:
            if date_cols and num:
                date_col = date_cols[0]
                title = f"{_col_to_label(num)} Trend by {_col_to_label(date_col)}"
                if title not in exclude_titles:
                    sql = (
                        f"SELECT {quote_ident(date_col)}, ROUND(SUM({quote_ident(num)})::numeric, 2) AS total "
                        f"FROM {qtable} GROUP BY {quote_ident(date_col)} ORDER BY 1 ASC LIMIT 30"
                    )
                    chart = await _try_chart(project_id, sql, title, "line", date_col, "total")
                    if chart:
                        out.append(chart)
                        exclude_titles.add(title)
            elif cat2 and num and len(out) < needed:
                title = f"Total {_col_to_label(num)} by {_col_to_label(cat2)}"
                if title not in exclude_titles:
                    sql = (
                        f"SELECT {quote_ident(cat2)}, ROUND(SUM({quote_ident(num)})::numeric, 2) AS total "
                        f"FROM {qtable} GROUP BY {quote_ident(cat2)} ORDER BY 2 DESC LIMIT 10"
                    )
                    chart = await _try_chart(project_id, sql, title, "bar", cat2, "total")
                    if chart:
                        out.append(chart)
                        exclude_titles.add(title)

    return out


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
        system_prompt=_build_prompt(state.get("project_name", ""), schema_ctx, findings, state.get("user_intent")),
        user_message="Design 5-6 charts, fetch each chart's data with one run_sql call, then call submit_charts.",
        tools=tools, max_iterations=20, max_tokens=12000,
    )

    charts = holder.get("charts") or []
    # Keep only supported chart types; drop anything malformed.
    clean: list[dict[str, Any]] = []
    for c in charts:
        ct = (c.get("chartType") or "").strip()
        if ct in supported and isinstance(c.get("config"), dict):
            clean.append({"title": c.get("title") or ct, "chartType": ct, "config": c["config"]})

    # Always supplement with programmatic charts to guarantee at least 5 visible charts.
    # This runs even when the LLM produced some charts — it only fills the gap.
    MIN_CHARTS = 5
    if len(clean) < MIN_CHARTS:
        supplement = await _supplement_charts(
            project_id=project_id,
            targets=targets,
            tables=tables,
            exclude_titles={c["title"] for c in clean},
            needed=MIN_CHARTS - len(clean),
        )
        clean = clean + supplement

    if not clean:
        clean = await _fallback_chart(project_id, targets, tables)

    return {"charts": clean}
