"""Data Modeler tools — port of `data-modeler/{tools,executor}.ts`.

Two tool sets: the semantic-model pass (list/classify/persist the graph, with an
in-memory star-schema carried across tool calls) and the dashboard-generation
pass (list/query/create-dashboard).
"""
from __future__ import annotations

import logging
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, ConfigDict, Field

from ...db.introspection import execute_warehouse_query as _exec_warehouse_query
from ...db.introspection import warehouse_columns_grouped
from ...db.repositories import semantic_models
from ..shared.serde import dumps
from .dashboards import create_project_dashboard

log = logging.getLogger("agents.data_modeler")


# --- Pydantic arg schemas (mirror DATA_MODELER_*_TOOLS) ---

class EmptyArgs(BaseModel):
    pass


class StarSchemaArgs(BaseModel):
    facts: list[str] = Field(description="Table names classified as Fact tables.")
    dimensions: list[str] = Field(description="Table names classified as Dimension tables.")
    rationale: str = Field(description="1-2 sentences explaining the classification.")


class JoinSpec(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    from_: str = Field(alias="from", description='Fully-qualified source: "<table>.<column>".')
    to: str = Field(description='Fully-qualified target: "<table>.<column>".')
    cardinality: str = Field(description="One of 1:1, 1:N, N:1, N:N.")


class GenerateSemanticGraphArgs(BaseModel):
    facts: list[str] = Field(default_factory=list)
    dimensions: list[str] = Field(default_factory=list)
    joins: list[JoinSpec] = Field(default_factory=list)
    rationale: str = Field(default="", description="1-3 sentences on why this graph fits the goal.")


class ExecuteQueryArgs(BaseModel):
    sql: str = Field(description="Fully-qualified SELECT or WITH ... SELECT against the warehouse schema.")


class ChartSpec(BaseModel):
    title: str
    chartType: str = Field(description="bar | horizontal-bar | line | area | pie | donut | scatter | bubble | kpi | table | ...")
    config: dict[str, Any] = Field(description="Chart config. MUST include sql; for visuals also xKey, yKey, data.")


class CreateDashboardArgs(BaseModel):
    title: str
    charts: list[ChartSpec]


async def _save_semantic_graph(project_id: int, facts: list[str], dimensions: list[str],
                               joins: list[dict[str, Any]], rationale: str) -> dict[str, Any]:
    await semantic_models.delete_proposed(project_id)
    graph = {"facts": facts, "dimensions": dimensions, "joins": joins}
    row = await semantic_models.insert_proposed(project_id, graph, rationale)
    return {"id": row["id"], "status": row["status"]}


def make_semantic_tools(project_id: int) -> list[StructuredTool]:
    state: dict[str, Any] = {"facts": [], "dimensions": [], "rationale": ""}

    async def list_warehouse_tables() -> str:
        log.info("data-modeler tool list_warehouse_tables project=%s", project_id)
        return dumps(await warehouse_columns_grouped(project_id))

    async def propose_star_schema(facts: list[str], dimensions: list[str], rationale: str) -> str:
        state.update({"facts": facts, "dimensions": dimensions, "rationale": rationale})
        log.info("data-modeler tool propose_star_schema project=%s", project_id)
        return dumps({"recorded": True, **state})

    async def generate_semantic_graph(**kwargs: Any) -> str:
        args = GenerateSemanticGraphArgs(**kwargs)
        facts = args.facts or state["facts"]
        dimensions = args.dimensions or state["dimensions"]
        joins = [{"from": j.from_, "to": j.to, "cardinality": j.cardinality} for j in args.joins]
        rationale = args.rationale or state["rationale"]
        log.info("data-modeler tool generate_semantic_graph project=%s joins=%s", project_id, len(joins))
        return dumps(await _save_semantic_graph(project_id, facts, dimensions, joins, rationale))

    return [
        StructuredTool.from_function(
            coroutine=list_warehouse_tables, name="list_warehouse_tables", args_schema=EmptyArgs,
            description="List every table/view in the project's warehouse schema with column names and types.",
        ),
        StructuredTool.from_function(
            coroutine=propose_star_schema, name="propose_star_schema", args_schema=StarSchemaArgs,
            description="Classify each warehouse table as a FACT or DIMENSION. Call once after inspecting all tables.",
        ),
        StructuredTool.from_function(
            coroutine=generate_semantic_graph, name="generate_semantic_graph",
            args_schema=GenerateSemanticGraphArgs,
            description="Persist the project's semantic graph (facts, dimensions, joins). Does NOT alter any physical table.",
        ),
    ]


def make_dashboard_tools(project_id: int) -> list[StructuredTool]:
    async def list_warehouse_tables() -> str:
        log.info("data-modeler tool list_warehouse_tables project=%s", project_id)
        return dumps(await warehouse_columns_grouped(project_id))

    async def execute_warehouse_query(sql: str) -> str:
        log.info("data-modeler tool execute_warehouse_query project=%s", project_id)
        try:
            return dumps(await _exec_warehouse_query(project_id, sql))
        except Exception as err:  # noqa: BLE001
            return dumps({"error": str(err)})

    async def create_dashboard(**kwargs: Any) -> str:
        args = CreateDashboardArgs(**kwargs)
        charts = [{"title": c.title, "chartType": c.chartType, "config": c.config} for c in args.charts]
        log.info("data-modeler tool create_dashboard project=%s title=%s", project_id, args.title)
        try:
            return dumps(await create_project_dashboard(project_id, args.title, charts))
        except Exception as err:  # noqa: BLE001
            return dumps({"error": str(err)})

    return [
        StructuredTool.from_function(
            coroutine=list_warehouse_tables, name="list_warehouse_tables", args_schema=EmptyArgs,
            description="List every table/view in the project's warehouse schema with column names and types.",
        ),
        StructuredTool.from_function(
            coroutine=execute_warehouse_query, name="execute_warehouse_query", args_schema=ExecuteQueryArgs,
            description="Run a SELECT against the project's warehouse schema. Returns up to 200 rows.",
        ),
        StructuredTool.from_function(
            coroutine=create_dashboard, name="create_dashboard", args_schema=CreateDashboardArgs,
            description="Persist a dashboard (title + charts) scoped to this project.",
        ),
    ]
