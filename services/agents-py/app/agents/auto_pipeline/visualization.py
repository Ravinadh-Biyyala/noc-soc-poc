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
    ID_KEYWORD,
    NUM_KEYWORD,
    NUMERIC_TYPE,
    _col_to_label,
    pick_category,
)
from .auto_tools import make_catalog_tool, make_warehouse_query_tool
from .catalog import catalog_digest_by_category, supported_chart_types
from ._run import make_submit_tool, run_subagent

log = logging.getLogger("agents.auto_pipeline")
NAME = "auto-visualization"

# The LLM often names a chart by its catalog NAME or a near-synonym rather than
# the exact renderable dashboardChartType. Map those near-misses onto a supported
# type instead of silently dropping the chart (which used to leave the dashboard
# with nothing but the programmatic fallback).
_CHART_TYPE_ALIASES = {
    "grouped-bar": "bar", "grouped bar": "bar", "groupedbar": "bar",
    "column": "bar", "column-chart": "bar", "vertical-bar": "bar", "clustered-bar": "bar",
    "horizontal bar": "horizontal-bar", "hbar": "horizontal-bar", "h-bar": "horizontal-bar",
    "stacked": "stacked-bar", "stacked bar": "stacked-bar",
    "100%-stacked-bar": "stacked-bar", "100% stacked bar": "stacked-bar", "normalized-bar": "stacked-bar",
    "stacked-area": "area", "stacked area": "area", "stackedarea": "area",
    "ring": "donut", "doughnut": "donut",
    "spider": "radar", "spider-chart": "radar", "radar-chart": "radar",
    "matrix": "table", "pivot": "table", "pivot-table": "table", "crosstab": "table",
    "datatable": "table", "data-table": "table", "data table": "table", "grid": "table",
    "scatter-plot": "scatter", "scatterplot": "scatter",
    "step": "line", "step-line": "line", "slope": "line", "spline": "line", "trend": "line",
    "progress": "progress-bar", "radial-bar": "progress-bar", "radialbar": "progress-bar", "radial": "progress-bar",
    "dial": "gauge", "speedometer": "gauge",
    "donut-chart": "donut", "pie-chart": "pie", "bar-chart": "bar", "line-chart": "line", "area-chart": "area",
}


def _canonical_chart_type(raw: str) -> str:
    ct = (raw or "").strip().lower()
    return _CHART_TYPE_ALIASES.get(ct, ct)


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
        "You are the Data Visualization agent in an autonomous BI pipeline. You are the FINAL "
        "storyteller: you turn the analysis findings into an industry-standard BI dashboard that "
        "tells the BUSINESS STORY of this data — what is happening, why, who leads or lags, and "
        "what to do — NOT a handful of generic aggregate bars.",
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
        "THE VISUALS CATALOG — walk EVERY category. The token right after the dash on each line is "
        "the chartType you emit:",
        catalog_digest_by_category(),
        "",
        "HOW A GREAT DASHBOARD READS (the whole point — build the narrative in this order):",
        "  1. COMPOSITION — what the whole is made of (pie / donut / treemap / stacked-bar / 100% stacked).",
        "  2. TREND — how the key metrics move over time (line / area / stacked-area / combo).",
        "  3. COMPARISON & RANKING — who/what leads or lags (bar / horizontal-bar / grouped bar).",
        "  4. DISTRIBUTION & RELATIONSHIP — spread and correlation (histogram / scatter / bubble / heatmap).",
        "  5. PERFORMANCE & FLOW — vs target and through stages (gauge / bullet / progress / radar / funnel / waterfall).",
        "  6. DETAIL — a multi-KPI breakdown grid (matrix/pivot 'table').",
        "  (KPI scorecards are generated automatically — do NOT emit 'kpi'.)",
        "",
        "YOUR JOB — be DIVERSE and business-driven, but DECISIVE: you MUST finish and call submit_charts.",
        "1. Go through the catalog category by category. For each chart type ask: 'does THIS data shape support "
        "it, and does it carry a real business message here?' If yes, BUILD it; if not, skip it and move on. Do "
        "NOT stop after the first few easy bars. Fit cues: pie/donut want <=5 categories, treemap wants many, "
        "histogram wants a continuous numeric, scatter/bubble want two numerics, funnel/waterfall want ordered "
        "stages, line/area want a date column, combo pairs a measure with a rate. HEATMAP is special: it needs TWO "
        "categorical dimensions (xKey AND yKey both categorical) plus a numeric measure — put that measure's column "
        "name in config.valueKey (e.g. xKey=region, yKey=deal_type, valueKey=total_deal_value). Use "
        "get_visuals_catalog if unsure; you may run one quick COUNT(DISTINCT col) to check cardinality.",
        "2. TARGET 10-14 strong charts that span as MANY of the categories above as the data supports — diversity "
        "over volume. A chart type MAY repeat for a genuinely different business question (revenue by region AND "
        "by brand), but never pad with near-duplicates. Don't chase all 39 types; pick the ones that tell the story.",
        "2a. DO NOT default everything to bar charts. A wall of bars is NOT a BI dashboard. Aim for AT LEAST 5-6 "
        "DISTINCT chart types, and deliberately reach past bar/line/pie into the under-used families WHENEVER the "
        "data supports them: treemap (one categorical with many values + a measure, e.g. deal value by property "
        "brand or by city); scatter/bubble (two/three numeric columns at row grain, e.g. commission_pct vs "
        "deal_value, bubble size = rooms); histogram (CASE/width_bucket bins of a continuous numeric, e.g. deal "
        "value distribution); donut/stacked-bar/100%-stacked (composition of a total); funnel (ordered pipeline "
        "stages, e.g. deal status Pending->In Progress->Closed counts); gauge/bullet (a single rate vs a sensible "
        "target, e.g. avg occupancy vs 70%); radar (one entity scored across 5-8 normalised metrics); combo (an "
        "absolute measure as bars + a rate as a line). A bar is the fallback only when no better-fitting type "
        "applies — justify each bar by its message, not its convenience.",
        "3. CRITICAL — never group or slice by an identifier / primary-key column (e.g. broker_id, owner_id, "
        "supplier_id, *_id, codes): those have one value per row and make meaningless 200-bar charts and pies. "
        "ALWAYS group by real business dimensions: region, owner/customer type, property brand, supplier category, "
        "status, segment, or a month/year bucket.",
        "4. Build at least ONE rich MATRIX/PIVOT 'table' chart: rows = a key dimension, columns = SEVERAL measures "
        "side by side (e.g. record count, total revenue, avg cost, a ratio, occupancy %), so a manager reads "
        "multiple KPIs per segment at a glance. This is what separates a real BI dashboard from a chart dump.",
    ]
    if user_intent:
        lines.append("5. PRIORITISE charts that directly answer the user's questions (e.g. performing vs "
                     "underperforming entities and why) — lead the dashboard with those.")
    else:
        lines.append("5. PRIORITISE the charts that best explain the findings above — the headline movements, "
                     "the biggest segments, the clearest comparisons, and the notable outliers.")
    lines += [
        "6. For each chart: write ONE focused SELECT (GROUP BY / window functions / CASE bins as needed), run it "
        "with run_sql to get the REAL rows, then move on. Never run the same query twice; if a query errors, fix "
        "it once or skip that chart. emit chartType EXACTLY as the token after the dash in the catalog.",
        "7. Each chart config MUST include: sql (the exact SELECT), data (the returned rows), xKey (categorical "
        "column) and yKey (numeric column, or a list of columns for multi-series / grouped / stacked / combo / "
        "pivot charts), and colors (an array of hex codes YOU choose — a coherent, professional palette: distinct "
        "hues for categorical comparisons, a single hue for a single series; reserve red/green for good/bad meaning).",
        "8. WORK EFFICIENTLY so you don't run out of turns: one SELECT per chart, no re-querying. As SOON as you "
        "have a diverse 10-14 chart set spanning the categories, STOP and call submit_charts ONCE with ALL the "
        "charts. Calling submit_charts is REQUIRED — a run that ends without it produces a generic fallback "
        "dashboard. Do not run any tool after submit_charts.",
    ]
    return "\n".join(lines)


async def _aggregate_chart(
    project_id: int, table: str, columns: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """Build ONE real GROUP BY bar chart for a target table by picking a
    performance/category dimension and a meaningful numeric measure with the
    same heuristics the KPI synthesiser uses. Returns None if the table has no
    chartable category column."""
    numeric = [
        c["name"] for c in columns
        if NUMERIC_TYPE.search(c["type"]) and not ID_KEYWORD.search(c["name"])
    ]
    categorical = [
        c["name"] for c in columns
        if not NUMERIC_TYPE.search(c["type"]) and not BOOL_TYPE.search(c["type"])
    ]
    cat = pick_category(categorical)
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
        numeric = [
            c["name"] for c in cols
            if NUMERIC_TYPE.search(c["type"]) and not ID_KEYWORD.search(c["name"])
        ]
        categorical = [
            c["name"] for c in cols
            if not NUMERIC_TYPE.search(c["type"]) and not BOOL_TYPE.search(c["type"])
        ]
        date_cols = [c for c in categorical if re.search(r"date|year|month|quarter|week|period|time", c, re.I)]
        # Real business dimensions only — never group by an id (one bar per row).
        dim_pool = [c for c in categorical if not ID_KEYWORD.search(c) and c not in date_cols]
        cat = pick_category(dim_pool)
        cat2 = next((c for c in dim_pool if c != cat), None) if cat else None
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
        user_message=(
            "Walk the visuals catalog category by category and build a DIVERSE set of 10-14 charts that tell the "
            "business story — span composition, trend, comparison, distribution, relationship, performance and "
            "flow, and include at least one multi-KPI pivot 'table'. Group by real business dimensions, never by "
            "id columns. Fetch each chart's real data with one run_sql call, then call submit_charts ONCE with "
            "all of them."
        ),
        tools=tools, max_iterations=46, max_tokens=16000,
    )

    charts = holder.get("charts") or []
    # Canonicalise near-miss chart types, keep only supported ones, drop malformed.
    clean: list[dict[str, Any]] = []
    dropped: list[str] = []
    for c in charts:
        ct = _canonical_chart_type(c.get("chartType") or "")
        if ct in supported and isinstance(c.get("config"), dict):
            clean.append({"title": c.get("title") or ct, "chartType": ct, "config": c["config"]})
        else:
            dropped.append(c.get("chartType") or "?")
    if dropped:
        log.warning("viz dropped %d unsupported/malformed charts: %s", len(dropped), dropped)

    # Always supplement with programmatic charts to guarantee a baseline of visible
    # charts. This runs even when the LLM produced some charts — it only fills the gap,
    # so a thin LLM run still yields a reasonably populated dashboard.
    MIN_CHARTS = 8
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
