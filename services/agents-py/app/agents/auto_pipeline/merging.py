"""Data Merging subagent (multihop).

Scans the cleaned warehouse tables, matches candidate join columns across them,
probes cardinality, then DECIDES per data:
  - materialize one denormalised `auto_flat_*` table (good for 1:1 / 1:N joins), OR
  - store join edges in project_relationship_links (better for N:N / fan-out),
and lets the analysis agents join on the fly.
"""
from __future__ import annotations

import logging
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from ...db.repositories import relationship_links as links_repo
from ...db.schemas import list_warehouse_tables
from ..shared.serde import dumps
from .auto_tools import (
    make_list_warehouse_tool,
    make_materialize_tool,
    make_warehouse_query_tool,
)
from ._run import make_submit_tool, run_subagent

log = logging.getLogger("agents.auto_pipeline")
NAME = "auto-merging"


class LinkSpec(BaseModel):
    fromTable: str
    fromColumn: str
    toTable: str
    toColumn: str
    cardinality: str = Field(default="N:1", description="One of 1:1, 1:N, N:1, N:N.")
    rationale: str = Field(default="")


class SaveLinksArgs(BaseModel):
    links: list[LinkSpec]


class MergeResult(BaseModel):
    strategy: str = Field(description="'flat' (a flat table was built), 'metadata' (links saved), or 'single' (one table, no merge).")
    flatTable: str | None = Field(default=None, description="Name of the auto_flat_* table, if strategy='flat'.")
    summary: str = Field(description="2-3 sentences on the join keys found and the decision taken.")


def _build_prompt(project_id: int, cleaned: dict[str, Any]) -> str:
    tables = cleaned.get("warehouseTables", [])
    lines = [
        "You are the Data Merging agent in an autonomous BI pipeline. Reason in multiple hops.",
        "",
        "CLEANED WAREHOUSE TABLES available to merge:",
        *[f"- {t}" for t in tables],
        "",
        "YOUR JOB:",
        "1. Call list_warehouse_tables to see exact columns of each cleaned table.",
        "2. Match candidate join columns across tables by name + type. Use run_sql with COUNT(*) and",
        "   COUNT(DISTINCT key) to probe cardinality (is the key unique on one side?).",
        "3. DECIDE:",
        "   - If there is ONE table only -> strategy='single' (no merge).",
        "   - If joins are 1:1 or 1:N and would NOT explode rows -> build ONE denormalised flat table via",
        "     materialize_table(target_table='auto_flat_main', select_sql=<a SELECT with the JOINs>). strategy='flat'.",
        "   - If any join is N:N or would fan out rows badly -> DO NOT flatten. Call save_relationships with the",
        "     join edges instead. strategy='metadata'.",
        "4. Call submit_merge ONCE with your decision. Then stop.",
        "SELECTs must be fully-qualified and SELECT-only; materialize_table writes the CREATE for you.",
    ]
    return "\n".join(lines)


async def run_merging(state: dict[str, Any]) -> dict[str, Any]:
    project_id = state["project_id"]
    cleaned = state.get("cleaned") or {}
    wh_before = [str(t["tableName"]) for t in await list_warehouse_tables(project_id)]

    holder: dict[str, Any] = {}
    saved_links: dict[str, Any] = {"links": []}
    errors: list[str] = []

    async def save_relationships(links: list[Any]) -> str:
        payload = [LinkSpec(**l).model_dump() if not isinstance(l, LinkSpec) else l.model_dump() for l in links]
        try:
            n = await links_repo.replace_for_project(project_id, payload)
            saved_links["links"] = payload
            return dumps({"saved": n})
        except Exception as err:  # noqa: BLE001
            log.warning("save_relationships failed project=%s err=%s", project_id, err)
            return dumps({"error": str(err)})

    save_links_tool = StructuredTool.from_function(
        coroutine=save_relationships, name="save_relationships", args_schema=SaveLinksArgs,
        description="Persist join relationships as metadata (use when NOT flattening). Replaces any prior links.",
    )

    tools = [
        make_list_warehouse_tool(project_id),
        make_warehouse_query_tool(project_id),
        make_materialize_tool(project_id),
        save_links_tool,
        make_submit_tool(
            name="submit_merge",
            description="Hand back the merge decision (strategy, flatTable, summary). Call once.",
            model=MergeResult, holder=holder,
        ),
    ]

    await run_subagent(
        name=NAME, project_id=project_id, system_prompt=_build_prompt(project_id, cleaned),
        user_message="Find join keys, decide flat-vs-metadata, act, then call submit_merge.",
        tools=tools, max_iterations=14, max_tokens=4096,
    )

    wh_after = [str(t["tableName"]) for t in await list_warehouse_tables(project_id)]
    flat_tables = [t for t in wh_after if t.startswith("auto_flat")]

    # Resolve which warehouse tables the analysis phase should read.
    if not holder:
        holder = {"strategy": "single" if len(wh_after) <= 1 else "metadata", "summary": "Auto-resolved merge decision."}
    if flat_tables:
        holder["strategy"] = "flat"
        holder["flatTable"] = holder.get("flatTable") or flat_tables[-1]
        holder["analysisTargets"] = [holder["flatTable"]]
    else:
        # No flat table: analyse the cleaned tables directly.
        holder["analysisTargets"] = [t for t in wh_after if t.startswith("auto_")] or wh_after
    holder["links"] = saved_links["links"]
    holder.setdefault("summary", "Merge phase complete.")

    delta: dict[str, Any] = {"merge": holder}
    if errors:
        delta["errors"] = errors
    return delta
