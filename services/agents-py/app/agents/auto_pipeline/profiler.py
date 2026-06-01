"""Data Profiler subagent.

Finds the raw tables, their columns/types/counts, profiles the most important
ones, and hands a structured schema map back to the orchestrator. The raw schema
is also gathered deterministically and seeded into the prompt so the phase is
robust even if the LLM under-uses its tools.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from .auto_tools import make_list_raw_tool, make_profile_tool, raw_tables_with_columns
from ._run import make_submit_tool, run_subagent

NAME = "auto-profiler"


class TableNote(BaseModel):
    table: str = Field(description="Raw table name.")
    role: str = Field(default="", description="Likely role, e.g. 'fact/transactional' or 'dimension/reference'.")
    keyColumns: list[str] = Field(default_factory=list, description="Candidate identifier/join columns.")
    note: str = Field(default="", description="One-line observation (grain, quality, notable columns).")


class ProfileResult(BaseModel):
    summary: str = Field(description="2-3 sentence overview of what the dataset contains.")
    tables: list[TableNote] = Field(default_factory=list)


def _build_prompt(project_name: str, description: str | None, raw_tables: list[dict[str, Any]]) -> str:
    lines = [
        "You are the Data Profiler in an autonomous BI pipeline.",
        f'PROJECT: "{project_name}".',
    ]
    if description:
        lines.append(f"GOAL: {description}")
    lines.append("")
    lines.append("RAW TABLES (read-only landing zone):")
    if raw_tables:
        for t in raw_tables:
            cols = ", ".join(f'{c["name"]} {c["type"]}' for c in t["columns"][:24])
            lines.append(f'- "{t["tableName"]}" (~{t["rowCount"]} rows): {cols}')
    else:
        lines.append("- (none yet)")
    lines.append("")
    lines.extend([
        "YOUR JOB:",
        "1. Call profile_table on the 2-4 most important tables to inspect nulls, distinct counts and ranges.",
        "2. Identify each table's likely role (fact vs dimension) and its candidate key/join columns.",
        "3. Call submit_profile ONCE with a concise summary and one entry per table. Then stop.",
        "Be fast and decisive — this is the first of several phases.",
    ])
    return "\n".join(lines)


async def run_profiler(state: dict[str, Any]) -> dict[str, Any]:
    project_id = state["project_id"]
    raw_tables = await raw_tables_with_columns(project_id)

    holder: dict[str, Any] = {}
    tools = [
        make_list_raw_tool(project_id),
        make_profile_tool(project_id, layer="raw"),
        make_submit_tool(
            name="submit_profile",
            description="Hand back the profiling summary and per-table notes. Call once.",
            model=ProfileResult, holder=holder,
        ),
    ]
    system_prompt = _build_prompt(state.get("project_name", ""), state.get("project_description"), raw_tables)
    user_message = "Profile the raw data now, then call submit_profile."

    summary = await run_subagent(
        name=NAME, project_id=project_id, system_prompt=system_prompt,
        user_message=user_message, tools=tools, max_iterations=8,
    )

    # Deterministic fallback so downstream phases always have the schema map.
    if not holder:
        holder = {
            "summary": summary.get("finalText") or f"{len(raw_tables)} raw table(s) detected.",
            "tables": [
                {"table": t["tableName"], "role": "", "keyColumns": [], "note": f'~{t["rowCount"]} rows'}
                for t in raw_tables
            ],
        }

    holder["rawTables"] = raw_tables
    return {"profile": holder}
