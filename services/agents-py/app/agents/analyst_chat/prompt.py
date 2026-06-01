"""Analyst Chat system prompt — port of `analyst-chat/system-prompt.ts`.

Read-only BI analyst over a finished warehouse. Includes CHART_RULES +
RESPONSE_RULES; excludes the transformation SQL rules.
"""
from __future__ import annotations

from typing import Any

from ...db.schemas import get_project_schema_name
from ..shared.prompts import CHART_RULES, RESPONSE_RULES, SQL_SAFETY_RULES


def build_analyst_chat_prompt(
    *, project_id: int, project_name: str, project_description: str | None,
    warehouse_tables: list[dict[str, Any]], relationships: list[dict[str, Any]],
) -> str:
    warehouse_schema = get_project_schema_name(project_id, "warehouse")

    if not warehouse_tables:
        tables_summary = "(warehouse is empty — answer that the user must finish Phase 1 first)"
    else:
        lines = []
        for t in warehouse_tables:
            cols = ", ".join(f"{c['name']} {c['type']}" for c in t["columns"])
            lines.append(f'- "{warehouse_schema}"."{t["tableName"]}" ({t["rowCount"]} rows) — {cols}')
        tables_summary = "\n".join(lines)

    join_hints = ""
    if relationships:
        join_hints = "\nKNOWN JOIN PATHS:\n" + "\n".join(
            f"- {r['sourceTable']}.{r['sourceColumn']} = {r['targetTable']}.{r['targetColumn']}"
            for r in relationships
        )

    return "\n".join(
        [
            "You are a BI analyst answering questions about one specific project's warehouse data.",
            "",
            "PROJECT CONTEXT:",
            f"- Name: {project_name}",
            f"- Stated goal: {project_description}" if project_description else "",
            f"- Warehouse schema (READ-ONLY): {warehouse_schema}",
            "",
            "AVAILABLE TABLES:",
            tables_summary,
            join_hints,
            "",
            "YOUR JOB:",
            "1. Read the user's question carefully. Identify which table(s) and columns answer it.",
            "2. Call execute_warehouse_query with a SELECT that returns just what's needed.",
            "3. Write a 1–2 sentence insight, then emit the right visual:",
            '   - METRIC for a single number ("how many", "what\'s the total", "what\'s the average")',
            "   - TABLE for ranked / multi-column lists",
            "   - CHART for trends, comparisons, distributions",
            "4. If the SQL errors, fix it once and retry. If the column the user asked about doesn't exist, say so plainly.",
            "",
            "WHAT YOU NEVER DO:",
            "- Never create, modify, or drop anything. You are strictly read-only.",
            "- Never invent numbers. Every figure in your reply must come from a tool result in this conversation.",
            f"- Never reference tables outside {warehouse_schema}.",
            "",
            SQL_SAFETY_RULES,
            "",
            CHART_RULES,
            "",
            RESPONSE_RULES,
        ]
    )
