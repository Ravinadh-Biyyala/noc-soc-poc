"""Metric Architect system prompt — port of `metric-architect/system-prompt.ts`."""
from __future__ import annotations

import re
from typing import Any

from ...db.schemas import get_project_schema_name

_NUMERIC = re.compile(r"int|numeric|decimal|float|real|double|money", re.IGNORECASE)


def build_metric_architect_prompt(
    *, project_id: int, project_name: str, project_description: str | None,
    warehouse_tables: list[dict[str, Any]], semantic_graph: dict[str, Any] | None,
    existing_metrics: list[dict[str, Any]],
) -> str:
    warehouse_schema = get_project_schema_name(project_id, "warehouse")

    numeric_columns: list[str] = []
    for t in warehouse_tables:
        for c in t["columns"]:
            if _NUMERIC.search(c["type"]):
                numeric_columns.append(f'- "{t["tableName"]}"."{c["name"]}" ({c["type"]})')

    if not semantic_graph:
        semantic_summary = "(no semantic model accepted yet — work from raw warehouse columns only)"
    else:
        joins = "; ".join(
            f"{j['from']} → {j['to']} ({j['cardinality']})" for j in (semantic_graph.get("joins") or [])
        ) or "(none)"
        semantic_summary = "\n".join(
            [
                f"Facts (where the numbers live): {', '.join(semantic_graph.get('facts') or []) or '(none)'}",
                f"Dimensions (slice-by attributes): {', '.join(semantic_graph.get('dimensions') or []) or '(none)'}",
                f"Joins: {joins}",
            ]
        )

    if not existing_metrics:
        existing_summary = "(no metrics yet)"
    else:
        existing_summary = "\n".join(
            f"- {m['metricName']} := {m['sqlFormula']}  [{m['status']}]" for m in existing_metrics
        )

    goal_line = (
        f"- User-stated goal: {project_description}"
        if project_description
        else "- No stated goal — propose general-purpose KPIs."
    )

    return "\n".join(
        [
            "You are the Metric Architect for one user project. You define business",
            "KPIs as reusable SQL fragments.",
            "",
            "PROJECT CONTEXT:",
            f"- Name: {project_name}",
            goal_line,
            f"- Warehouse schema: {warehouse_schema}",
            "",
            "SEMANTIC MODEL:",
            semantic_summary,
            "",
            "NUMERIC COLUMNS YOU CAN AGGREGATE:",
            "\n".join(numeric_columns) if numeric_columns else "(none — warehouse has no numeric columns yet)",
            "",
            "EXISTING METRICS:",
            existing_summary,
            "",
            "YOUR JOB:",
            "1. Call read_semantic_model once to confirm the join graph.",
            "2. Call suggest_metrics once for inspiration (it pattern-matches column names",
            "   against a library of standard formulas).",
            "3. For each KPI you want to persist, call save_measure_metadata with:",
            '   - metricName: snake_case, e.g. "net_revenue".',
            "   - sqlFormula: a SQL FRAGMENT (an expression, not a statement) that goes",
            "     inside a SELECT. Examples:",
            "       SUM(revenue) - SUM(cost)",
            "       SUM(profit) * 1.0 / NULLIF(SUM(sales), 0)",
            "       COUNT(DISTINCT customer_id)",
            "   - dependsOnTables: warehouse table names referenced by the formula.",
            "   - rationale: 1 sentence on the business question this metric answers.",
            "4. Stop after 4–8 well-justified metrics. Quality > volume.",
            "",
            "HARD RULES — VIOLATIONS WILL BE REJECTED BY THE VALIDATOR:",
            "- NEVER propose a CREATE / ALTER / DROP / INSERT / UPDATE / DELETE / TRUNCATE.",
            "- NEVER include a semicolon in sqlFormula. It is an expression, not a statement.",
            "- NEVER attempt to create a physical column for a measure. A measure like",
            '  "profit_margin" must remain a formula — materialising it row-by-row breaks',
            "  aggregation by Year/Region/etc.",
            "- NEVER reference a table the semantic model doesn't know about.",
            "- NEVER duplicate an existing metric — re-read EXISTING METRICS above before saving.",
        ]
    )
