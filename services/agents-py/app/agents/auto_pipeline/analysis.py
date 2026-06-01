"""Data Analysis subagents — 5 lenses that run in parallel.

Each lens is a multihop ReAct agent that queries the (cleaned/merged) warehouse
with SQL and reasons over the results. No ML: predictive/prescriptive are LLM
reasoning over SQL aggregates, trends and window functions.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from ...db.introspection import warehouse_tables_with_columns
from .auto_tools import make_warehouse_query_tool
from ._run import make_submit_tool, run_subagent

LENS_GUIDANCE: dict[str, str] = {
    "descriptive": (
        "DESCRIPTIVE — what happened. Compute totals, averages, counts, min/max and the distribution across the "
        "main categorical dimensions. Surface the headline numbers and the biggest segments."
    ),
    "diagnostic": (
        "DIAGNOSTIC — why it happened. Find drivers, correlations and anomalies. Compare segments against the "
        "overall average, rank contributors, and flag outliers using window functions / GROUP BY."
    ),
    "predictive": (
        "PREDICTIVE — what is likely next. Read time-ordered data, compute period-over-period growth rates / moving "
        "trends with SQL, and reason (no ML model) about the likely near-term direction and which segments are rising."
    ),
    "prescriptive": (
        "PRESCRIPTIVE — what to do. Based on the SQL evidence, recommend concrete business actions: where to focus, "
        "what to fix, which segments to grow or de-risk. Tie every recommendation to a number you queried."
    ),
    "comparative": (
        "COMPARATIVE — how groups/periods differ. Run side-by-side comparisons: segment vs segment, "
        "period vs prior period, top vs bottom performers. Quantify the gaps."
    ),
}


class Metric(BaseModel):
    label: str
    value: str = Field(description="The value as text (e.g. '1,234' or '12.3%').")


class FindingResult(BaseModel):
    summary: str = Field(description="2-4 sentence narrative of what this analysis found.")
    keyFindings: list[str] = Field(default_factory=list, description="3-6 specific, number-backed bullet findings.")
    recommendations: list[str] = Field(default_factory=list, description="Actionable recommendations (mainly for prescriptive).")
    metrics: list[Metric] = Field(default_factory=list, description="Headline metrics worth charting.")


def _schema_context(tables: list[dict[str, Any]], targets: list[str], links: list[dict[str, Any]]) -> str:
    chosen = [t for t in tables if t["tableName"] in targets] or tables
    lines = ["WAREHOUSE TABLES you may query:"]
    for t in chosen:
        cols = ", ".join(f'{c["name"]} {c["type"]}' for c in t["columns"][:30])
        lines.append(f'- "{t["tableName"]}": {cols}')
    if links:
        lines.append("")
        lines.append("KNOWN JOIN PATHS (join on the fly):")
        for l in links:
            lines.append(f'- {l["fromTable"]}.{l["fromColumn"]} = {l["toTable"]}.{l["toColumn"]} ({l["cardinality"]})')
    return "\n".join(lines)


def _build_prompt(lens: str, project_name: str, description: str | None, schema_ctx: str) -> str:
    lines = [
        f"You are the {lens.capitalize()} Analysis agent in an autonomous BI pipeline. Reason in multiple hops.",
        f'PROJECT: "{project_name}".',
    ]
    if description:
        lines.append(f"GOAL: {description}")
    lines += [
        "",
        schema_ctx,
        "",
        "FOCUS: " + LENS_GUIDANCE.get(lens, ""),
        "",
        "YOUR JOB:",
        "1. Run AT MOST 4 run_sql queries (SELECT-only, warehouse schema, <=200 rows) to gather evidence.",
        "   Prefer a few well-chosen aggregate queries over many small ones.",
        "2. Reason over the results.",
        "3. Then you MUST call submit_finding ONCE with a summary, number-backed key findings, any "
        "recommendations, and the headline metrics worth charting. Do not exceed 4 queries before submitting.",
    ]
    return "\n".join(lines)


async def run_analysis_lens(state: dict[str, Any], lens: str) -> dict[str, Any]:
    project_id = state["project_id"]
    merge = state.get("merge") or {}
    targets = merge.get("analysisTargets") or []
    links = merge.get("links") or []

    try:
        tables = await warehouse_tables_with_columns(project_id)
    except Exception:  # noqa: BLE001
        tables = []
    schema_ctx = _schema_context(tables, targets, links)

    holder: dict[str, Any] = {}
    tools = [
        make_warehouse_query_tool(project_id),
        make_submit_tool(
            name="submit_finding",
            description=f"Hand back the {lens} analysis result. Call once at the end.",
            model=FindingResult, holder=holder,
        ),
    ]
    system_prompt = _build_prompt(
        lens, state.get("project_name", ""), state.get("project_description"), schema_ctx
    )
    summary = await run_subagent(
        name=f"auto-analysis-{lens}", project_id=project_id, system_prompt=system_prompt,
        user_message=f"Perform the {lens} analysis now (max 4 queries), then call submit_finding.",
        tools=tools, max_iterations=14, max_tokens=4096,
    )

    if not holder:
        holder = {
            "summary": summary.get("finalText") or f"No {lens} findings produced.",
            "keyFindings": [], "recommendations": [], "metrics": [],
        }
    holder["lens"] = lens
    return {"findings": {lens: holder}}
