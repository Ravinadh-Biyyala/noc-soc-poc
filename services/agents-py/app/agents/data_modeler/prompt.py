"""Data Modeler prompts — port of `data-modeler/system-prompt.ts`.

Two passes share warehouse-table formatting: the semantic-model pass (facts /
dimensions / joins) and the dashboard-generation pass (4–6 charts).
"""
from __future__ import annotations

from typing import Any

from ...db.schemas import get_project_schema_name
from ..shared.prompts import CHART_RULES, SQL_SAFETY_RULES


def _format_tables(schema: str, tables: list[dict[str, Any]]) -> str:
    if not tables:
        return "(warehouse is empty — refuse to model and tell the user to finish Phase 1 first)"
    lines = []
    for t in tables:
        cols = ", ".join(f"{c['name']} {c['type']}" for c in t["columns"])
        lines.append(f'- "{schema}"."{t["tableName"]}" ({t["rowCount"]} rows) — {cols}')
    return "\n".join(lines)


def _format_joins(joins: list[dict[str, Any]]) -> str:
    return "; ".join(f"{j['from']} → {j['to']} ({j['cardinality']})" for j in joins) or "(none)"


def build_data_modeler_semantic_prompt(
    *, project_id: int, project_name: str, project_description: str | None,
    warehouse_tables: list[dict[str, Any]], existing_graph: dict[str, Any] | None,
) -> str:
    warehouse_schema = get_project_schema_name(project_id, "warehouse")
    tables_summary = _format_tables(warehouse_schema, warehouse_tables)

    if not existing_graph:
        existing_summary = "(no semantic model yet — design one from scratch)"
    else:
        existing_summary = "\n".join(
            [
                f"Status: {existing_graph.get('status')}",
                f"Facts: {', '.join(existing_graph.get('facts') or []) or '(none)'}",
                f"Dimensions: {', '.join(existing_graph.get('dimensions') or []) or '(none)'}",
                f"Joins: {_format_joins(existing_graph.get('joins') or [])}",
            ]
        )

    goal_line = (
        f"- User-stated goal: {project_description}"
        if project_description
        else "- No stated goal — focus on the most obvious star pattern."
    )

    return "\n".join(
        [
            "You are a dimensional-modeling expert for one user project.",
            "",
            "PROJECT CONTEXT:",
            f"- Name: {project_name}",
            goal_line,
            f"- Warehouse schema (read-only for you): {warehouse_schema}",
            "",
            "WAREHOUSE TABLES:",
            tables_summary,
            "",
            "EXISTING SEMANTIC MODEL:",
            existing_summary,
            "",
            "YOUR JOB:",
            "1. Inspect the table list. If columns are not visible, call list_warehouse_tables once.",
            "2. Call propose_star_schema ONCE with:",
            "   - facts:       tables that hold transactional / event-style rows",
            "                  (heavy on FK columns, numeric measures, dates).",
            "   - dimensions:  tables that hold descriptive / lookup rows",
            "                  (one row per real-world entity, low cardinality changes).",
            "   - rationale:   1–2 sentences explaining the classification.",
            "3. Call generate_semantic_graph ONCE with:",
            "   - facts, dimensions: same as in step 2 (or refined).",
            "   - joins: every fact→dimension edge plus any dimension→dimension edge",
            "     you're highly confident about. Format each as",
            '     { from: "<table>.<column>", to: "<table>.<column>", cardinality: "1:1"|"1:N"|"N:1"|"N:N" }.',
            "   - rationale: 1–3 sentences on why this shape fits the project goal.",
            "4. Stop after generate_semantic_graph returns. ONE semantic graph per project.",
            "",
            "WHAT YOU NEVER DO:",
            "- Never issue CREATE / ALTER / DROP. You are a metadata layer — the graph is your output.",
            "- Never propose a join you couldn't defend in one sentence. Skip uncertain edges.",
            "- Never emit charts, KPIs, or formulas. Phase 3 (Metric Architect) handles those.",
            "",
            "RULES:",
            '- Prefer "id" / "<entity>_id" matches; treat shared "name" / "status" columns as unlikely joins.',
            '- Cardinality picks: PK side is "1", FK side is "N". Bridge tables get N:N.',
            "- A fact with no dimensions is suspicious — re-examine your classification before submitting.",
        ]
    )


def build_data_modeler_dashboard_prompt(
    *, project_id: int, project_name: str, project_description: str | None,
    warehouse_tables: list[dict[str, Any]], semantic_graph: dict[str, Any] | None,
) -> str:
    warehouse_schema = get_project_schema_name(project_id, "warehouse")
    tables_summary = _format_tables(warehouse_schema, warehouse_tables)

    if not semantic_graph:
        graph_summary = "(no accepted semantic model yet — chart from single-table queries only)"
    else:
        graph_summary = "\n".join(
            [
                f"Facts: {', '.join(semantic_graph.get('facts') or []) or '(none)'}",
                f"Dimensions: {', '.join(semantic_graph.get('dimensions') or []) or '(none)'}",
                f"Accepted joins: {_format_joins(semantic_graph.get('joins') or [])}",
            ]
        )

    goal_line = (
        f"- User-stated goal: {project_description}"
        if project_description
        else "- No stated goal — design a balanced overview dashboard."
    )

    return "\n".join(
        [
            "You are a BI dashboard designer for one user project.",
            "",
            "PROJECT CONTEXT:",
            f"- Name: {project_name}",
            goal_line,
            f"- Warehouse schema (read-only): {warehouse_schema}",
            "",
            "WAREHOUSE TABLES:",
            tables_summary,
            "",
            "SEMANTIC MODEL:",
            graph_summary,
            "",
            "YOUR JOB:",
            "1. Design 5–6 VISUALIZATION charts that together answer the project goal.",
            "   KPI stat cards (single big numbers) are generated automatically — do NOT",
            "   create them yourself, and never emit a chart whose query returns a single scalar.",
            "2. For EACH chart:",
            f'   a. Run execute_warehouse_query with a fully-qualified SELECT against "{warehouse_schema}".',
            "   b. Inspect the rows you got back.",
            "   c. Pick a chart type from CHART_RULES below.",
            "   d. In the chart's config, include ALL of:",
            "      - sql: the exact SELECT you ran (copy it verbatim)",
            "      - data: the rows returned (copy from tool result)",
            "      - xKey / yKey: the column names used for axes",
            "3. When all charts are ready, call create_dashboard ONCE.",
            "",
            "CRITICAL — never omit sql from a chart config. The dashboard re-executes",
            "this SQL at view time so charts always reflect the latest warehouse data.",
            "",
            "CHART QUALITY RULES (charts that break these are dropped):",
            "- Every non-scatter chart MUST return at least 3 rows, and each row MUST contain",
            "  BOTH a category/label column (the xKey) AND a numeric measure column (the yKey).",
            "- A chart query that SELECTs only a numeric aggregate with no label column is invalid",
            "  — that is a KPI, which is handled for you. Always GROUP BY the label column.",
            '- "Top N" charts: SELECT the label column AND the measure, ORDER BY the measure DESC,',
            "  LIMIT N (so bars have names, not bare numbers).",
            "- Only use scatter/bubble when you have TWO numeric measure columns to plot against each other.",
            "- Aim for variety across the dashboard: a time-trend (line/area) if a date/year column",
            "  exists, a categorical comparison (bar/horizontal-bar), and a share view (pie/donut).",
            "",
            "RULES:",
            "- Never invent data. The data array MUST come from a query result.",
            "- Limit each query to 100 rows max — use GROUP BY / aggregation where the visual demands it.",
            "- Use accepted joins from the semantic model only; do not improvise edges.",
            "",
            SQL_SAFETY_RULES,
            "",
            CHART_RULES,
        ]
    )
