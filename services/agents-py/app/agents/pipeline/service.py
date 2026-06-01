"""Phase service functions used by the orchestration graph.

Each builds the agent's system prompt from live project context and runs the
corresponding agent. The discrete routes build the same prompts inline; these
wrappers let the pipeline graph reuse the agents without importing the FastAPI
handlers.
"""
from __future__ import annotations

from typing import Any

from ...db.introspection import columns_for_table, warehouse_tables_with_columns
from ...db.repositories import metrics as metrics_repo
from ...db.repositories import semantic_models as sm_repo
from ...db.repositories import workspaces
from ...db.schemas import create_project_schemas, list_raw_tables, raw_schema
from ..data_engineer.agent import run_data_engineer_suggest
from ..data_engineer.prompt import build_data_engineer_prompt
from ..data_modeler.agent import run_semantic_suggest
from ..data_modeler.prompt import build_data_modeler_semantic_prompt
from ..metric_architect.agent import run_metric_architect_suggest
from ..metric_architect.prompt import build_metric_architect_prompt


async def phase_data_engineer(project_id: int) -> dict[str, Any]:
    project = await workspaces.get_project(project_id)
    if not project:
        return {"error": "Project not found"}
    await create_project_schemas(project_id)
    schema = raw_schema(project_id)
    raw_tables = await list_raw_tables(project_id)
    enriched = []
    for t in raw_tables:
        cols = await columns_for_table(schema, t["tableName"])
        enriched.append({"tableName": t["tableName"], "rowCount": t["rowCount"],
                         "columns": [{"name": c["name"], "type": c["type"]} for c in cols]})
    prompt = build_data_engineer_prompt(
        project_id=project_id, project_name=project["name"],
        project_description=project.get("description"), raw_tables=enriched,
    )
    return await run_data_engineer_suggest(project_id, prompt)


async def phase_data_modeler(project_id: int) -> dict[str, Any]:
    project = await workspaces.get_project(project_id)
    if not project:
        return {"error": "Project not found"}
    tables = await warehouse_tables_with_columns(project_id)
    existing_raw = await sm_repo.latest_raw(project_id)
    existing_graph = None
    if existing_raw:
        gd = existing_raw["graph_definition"] or {}
        existing_graph = {"facts": gd.get("facts") or [], "dimensions": gd.get("dimensions") or [],
                          "joins": gd.get("joins") or [], "status": existing_raw["status"]}
    prompt = build_data_modeler_semantic_prompt(
        project_id=project_id, project_name=project["name"],
        project_description=project.get("description"),
        warehouse_tables=tables, existing_graph=existing_graph,
    )
    return await run_semantic_suggest(project_id, prompt)


async def phase_metric_architect(project_id: int) -> dict[str, Any]:
    project = await workspaces.get_project(project_id)
    if not project:
        return {"error": "Project not found"}
    tables = await warehouse_tables_with_columns(project_id)
    applied_sm = await sm_repo.get_applied_raw(project_id)
    semantic_graph = applied_sm["graph_definition"] if applied_sm else None
    existing = await metrics_repo.existing_summaries(project_id)
    prompt = build_metric_architect_prompt(
        project_id=project_id, project_name=project["name"],
        project_description=project.get("description"),
        warehouse_tables=tables, semantic_graph=semantic_graph, existing_metrics=existing,
    )
    return await run_metric_architect_suggest(project_id, prompt)
