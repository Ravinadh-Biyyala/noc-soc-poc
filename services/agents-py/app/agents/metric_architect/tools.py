"""Metric Architect tools — port of `metric-architect/{tools,executor}.ts`.

Read-only against the warehouse + semantic model, write-only to project_metrics.
save_measure_metadata enforces `assert_measure_formula` before any write.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from ...db.introspection import warehouse_columns_grouped
from ...db.repositories import metrics as repo
from ...db.repositories import semantic_models as sm_repo
from ..shared.serde import dumps
from ..shared.validation import SqlValidationError, assert_measure_formula

log = logging.getLogger("agents.metric_architect")

REVENUE = re.compile(r"revenue|sales|amount|total|price|gross", re.IGNORECASE)
COST = re.compile(r"cost|expense|spend|cogs|overhead", re.IGNORECASE)
QUANTITY = re.compile(r"quantity|qty|count|units|volume", re.IGNORECASE)
CUSTOMER = re.compile(r"customer|client|user|account", re.IGNORECASE)
PROFIT = re.compile(r"profit|margin|net", re.IGNORECASE)
NUMERIC = re.compile(r"int|numeric|decimal|float|real|double|money", re.IGNORECASE)
METRIC_NAME = re.compile(r"^[a-z][a-z0-9_]{1,127}$")


async def _read_semantic_model(project_id: int) -> dict[str, Any]:
    row = await sm_repo.get_applied_raw(project_id)
    if not row:
        return {"graph": None}
    return {"graph": row["graph_definition"], "agentRationale": row["agent_rationale"]}


async def _suggest_metrics(project_id: int, column_hints: list[str]) -> dict[str, Any]:
    tables = await warehouse_columns_grouped(project_id)
    hint_re = None
    if column_hints:
        hint_re = re.compile("|".join(re.escape(h) for h in column_hints), re.IGNORECASE)

    suggestions: list[dict[str, Any]] = []
    for t in tables:
        for c in t["columns"]:
            if not NUMERIC.search(c["type"]):
                continue
            if hint_re and not hint_re.search(c["name"]):
                continue
            qualified = f'"{t["tableName"]}"."{c["name"]}"'
            name_lower = c["name"].lower()
            if REVENUE.search(c["name"]):
                suggestions.append({"metricName": f"total_{name_lower}", "description": f"Total {c['name']} across all rows.",
                                    "sqlFormula": f"SUM({qualified})", "matchedColumn": c["name"], "matchedTable": t["tableName"]})
            if COST.search(c["name"]):
                suggestions.append({"metricName": f"total_{name_lower}", "description": f"Total {c['name']} across all rows.",
                                    "sqlFormula": f"SUM({qualified})", "matchedColumn": c["name"], "matchedTable": t["tableName"]})
            if QUANTITY.search(c["name"]):
                suggestions.append({"metricName": f"total_{name_lower}", "description": f"Total {c['name']}.",
                                    "sqlFormula": f"SUM({qualified})", "matchedColumn": c["name"], "matchedTable": t["tableName"]})
            if CUSTOMER.search(c["name"]) and re.search(r"id$", c["name"], re.IGNORECASE):
                suggestions.append({"metricName": f"distinct_{name_lower}s", "description": f"Unique {c['name']} count.",
                                    "sqlFormula": f"COUNT(DISTINCT {qualified})", "matchedColumn": c["name"], "matchedTable": t["tableName"]})
            if PROFIT.search(c["name"]):
                suggestions.append({"metricName": f"avg_{name_lower}_pct",
                                    "description": f"Average {c['name']} as a fraction of revenue (if a revenue column is present, otherwise raw average).",
                                    "sqlFormula": f"AVG({qualified})", "matchedColumn": c["name"], "matchedTable": t["tableName"]})

    revenue_cols = [{"table": t["tableName"], "column": c["name"]} for t in tables for c in t["columns"] if REVENUE.search(c["name"])]
    cost_cols = [{"table": t["tableName"], "column": c["name"]} for t in tables for c in t["columns"] if COST.search(c["name"])]
    if revenue_cols and cost_cols:
        r, c = revenue_cols[0], cost_cols[0]
        if r["table"] == c["table"]:
            suggestions.append({"metricName": "gross_profit", "description": f"Gross profit = total {r['column']} − total {c['column']}.",
                                "sqlFormula": f'SUM("{r["table"]}"."{r["column"]}") - SUM("{c["table"]}"."{c["column"]}")',
                                "matchedColumn": f"{r['column']}, {c['column']}", "matchedTable": r["table"]})
            suggestions.append({"metricName": "profit_margin_pct", "description": "Profit margin as a percentage = (revenue − cost) / revenue × 100.",
                                "sqlFormula": f'(SUM("{r["table"]}"."{r["column"]}") - SUM("{c["table"]}"."{c["column"]}")) * 100.0 / NULLIF(SUM("{r["table"]}"."{r["column"]}"), 0)',
                                "matchedColumn": f"{r['column']}, {c['column']}", "matchedTable": r["table"]})

    return {"suggestions": suggestions}


async def _save_measure(project_id: int, args: "SaveMeasureArgs") -> dict[str, Any]:
    metric_name = (args.metricName or "").strip()
    if not METRIC_NAME.match(metric_name):
        return {"error": "metricName must be snake_case, start with a letter, and be ≤128 chars."}
    try:
        assert_measure_formula(args.sqlFormula)
    except SqlValidationError as err:
        return {"error": str(err)}

    depends_on = [str(x) for x in (args.dependsOnTables or [])]
    existing = await repo.get_by_name(project_id, metric_name)
    if existing:
        updated = await repo.update_definition(
            existing["id"], description=args.description, sql_formula=args.sqlFormula,
            depends_on_tables=depends_on, agent_rationale=args.rationale,
        )
        return {"id": updated["id"], "status": updated["status"], "updated": True}

    row = await repo.insert(
        project_id, metric_name=metric_name, description=args.description,
        sql_formula=args.sqlFormula, depends_on_tables=depends_on, agent_rationale=args.rationale,
    )
    return {"id": row["id"], "status": row["status"]}


# --- Pydantic arg schemas ---

class EmptyArgs(BaseModel):
    pass


class SuggestMetricsArgs(BaseModel):
    columnHints: list[str] = Field(default_factory=list, description='Optional column names ("revenue", "cost") to bias suggestions.')


class SaveMeasureArgs(BaseModel):
    metricName: str = Field(description='snake_case identifier, e.g. "net_revenue".')
    description: str | None = Field(default=None, description="1–2 sentences explaining the metric.")
    sqlFormula: str = Field(description='SQL expression usable inside a SELECT — e.g. "SUM(revenue) - SUM(cost)". No DDL, no semicolons.')
    dependsOnTables: list[str] = Field(default_factory=list, description="Warehouse table names whose columns this formula references.")
    rationale: str | None = Field(default=None, description="Why this metric matters for the project goal.")


def make_metric_architect_tools(project_id: int) -> list[StructuredTool]:
    async def read_semantic_model() -> str:
        log.info("metric-architect tool read_semantic_model project=%s", project_id)
        return dumps(await _read_semantic_model(project_id))

    async def list_warehouse_tables() -> str:
        log.info("metric-architect tool list_warehouse_tables project=%s", project_id)
        return dumps(await warehouse_columns_grouped(project_id))

    async def suggest_metrics(columnHints: list[str] | None = None) -> str:
        log.info("metric-architect tool suggest_metrics project=%s", project_id)
        return dumps(await _suggest_metrics(project_id, columnHints or []))

    async def save_measure_metadata(**kwargs: Any) -> str:
        log.info("metric-architect tool save_measure_metadata project=%s name=%s", project_id, kwargs.get("metricName"))
        return dumps(await _save_measure(project_id, SaveMeasureArgs(**kwargs)))

    return [
        StructuredTool.from_function(
            coroutine=read_semantic_model, name="read_semantic_model", args_schema=EmptyArgs,
            description="Return the applied semantic graph (facts, dimensions, joins) for this project.",
        ),
        StructuredTool.from_function(
            coroutine=list_warehouse_tables, name="list_warehouse_tables", args_schema=EmptyArgs,
            description="List every table/view in the project's warehouse schema with column names and types.",
        ),
        StructuredTool.from_function(
            coroutine=suggest_metrics, name="suggest_metrics", args_schema=SuggestMetricsArgs,
            description="Return standard metric formulas that pattern-match the warehouse's numeric columns. Hint pass only — saves nothing.",
        ),
        StructuredTool.from_function(
            coroutine=save_measure_metadata, name="save_measure_metadata", args_schema=SaveMeasureArgs,
            description="Persist a metric definition. sqlFormula is a SQL FRAGMENT substituted into a SELECT clause. No DDL, no semicolons.",
        ),
    ]
