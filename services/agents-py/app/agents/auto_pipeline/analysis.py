"""Data Analysis subagents — 5 lenses that run in parallel.

Each lens is a multihop ReAct agent that queries the (cleaned/merged) warehouse
with SQL and reasons over the results. No ML: predictive/prescriptive are LLM
reasoning over SQL aggregates, trends and window functions.
"""
from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from ...db.introspection import warehouse_tables_with_columns
from .auto_tools import make_warehouse_query_tool
from ._run import make_submit_tool, run_subagent

log = logging.getLogger("agents.auto_pipeline")

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
    # The model naturally emits numbers here (e.g. 16.72); Pydantic v2 will not
    # coerce int/float -> str on its own, so an un-stringified value would fail
    # validation and the agent would loop until it hit the recursion limit and
    # submitted nothing. Coerce instead of rejecting.
    model_config = ConfigDict(coerce_numbers_to_str=True)

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


def _build_prompt(
    lens: str, project_name: str, description: str | None, schema_ctx: str, user_intent: str | None = None
) -> str:
    lines = [
        f"You are the {lens.capitalize()} Analysis agent in an autonomous BI pipeline. Reason in multiple hops.",
        f'PROJECT: "{project_name}".',
    ]
    if description:
        lines.append(f"GOAL: {description}")
    if user_intent:
        lines += ["", user_intent]
    lines += [
        "",
        schema_ctx,
        "",
        "FOCUS: " + LENS_GUIDANCE.get(lens, ""),
        "",
        "YOUR JOB — be decisive and FINISH:",
        "1. Run a HARD MAXIMUM of 3 run_sql queries (SELECT-only, warehouse schema, <=200 rows). Prefer ONE or TWO "
        "well-chosen aggregate queries (GROUP BY / window functions). Never run the same query twice.",
        "2. If a query returns an error, fix it ONCE; if it still errors, abandon that angle and move on — do NOT "
        "keep retrying.",
        "3. As soon as you have evidence (or after 3 queries, whichever comes first), STOP querying and call "
        "submit_finding EXACTLY ONCE with a summary, number-backed key findings, any recommendations, and the "
        "headline metrics worth charting. Calling submit_finding is REQUIRED and ends your turn — do not run any "
        "tool after it.",
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
        lens, state.get("project_name", ""), state.get("project_description"), schema_ctx,
        state.get("user_intent"),
    )
    summary = await run_subagent(
        name=f"auto-analysis-{lens}", project_id=project_id, system_prompt=system_prompt,
        user_message=f"Perform the {lens} analysis now (3 queries max), then call submit_finding.",
        tools=tools, max_iterations=18, max_tokens=4096,
    )

    if not holder:
        # The agent never submitted (e.g. it looped on queries / failed submit
        # validation and hit the recursion limit). Don't surface the raw error
        # text as a "finding", but DO log the run summary so an empty lens is
        # diagnosable instead of silently indistinguishable from "no data".
        final = summary.get("finalText") or ""
        log.warning(
            "auto-analysis-%s produced no finding "
            "(iterations=%s toolCallCount=%s toolCallsByName=%s finalText=%.200s)",
            lens, summary.get("iterations"), summary.get("toolCallCount"),
            summary.get("toolCallsByName"), final,
        )
        clean = final if final and "error]" not in final else f"No {lens} findings were produced for this dataset."
        holder = {
            "summary": clean,
            "keyFindings": [], "recommendations": [], "metrics": [],
        }
    holder["lens"] = lens
    return {"findings": {lens: holder}}
