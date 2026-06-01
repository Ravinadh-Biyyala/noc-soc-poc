"""Cross-phase pipeline graph with human-in-the-loop interrupts.

This is the idiomatic LangGraph representation of the three-phase, human-gated
pipeline: each phase runs its agent (writing proposals to the project_* tables),
then `interrupt()` pauses the run to surface those proposals for approval. The
caller resumes with `Command(resume={"approved": bool})`; a rejection ends the
run. State + interrupts are persisted by the shared AsyncPostgresSaver, so a
pipeline survives across HTTP requests keyed by thread `pipeline:{project_id}`.

The discrete /suggest + /accept endpoints remain the primary API contract; this
graph is the structured orchestration that exercises native interrupts.
"""
from __future__ import annotations

from typing import Any, TypedDict

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from .service import phase_data_engineer, phase_data_modeler, phase_metric_architect


class PipelineState(TypedDict, total=False):
    project_id: int
    summaries: dict[str, Any]
    approvals: dict[str, Any]


def _approved(decision: Any) -> bool:
    if isinstance(decision, dict):
        return bool(decision.get("approved", True))
    return bool(decision)


async def _data_engineer(state: PipelineState) -> dict[str, Any]:
    res = await phase_data_engineer(state["project_id"])
    return {"summaries": {**state.get("summaries", {}), "data_engineer": res}}


def _review_de(state: PipelineState) -> dict[str, Any]:
    decision = interrupt({"phase": "data_engineer", "summary": state.get("summaries", {}).get("data_engineer")})
    return {"approvals": {**state.get("approvals", {}), "data_engineer": decision}}


async def _data_modeler(state: PipelineState) -> dict[str, Any]:
    res = await phase_data_modeler(state["project_id"])
    return {"summaries": {**state.get("summaries", {}), "data_modeler": res}}


def _review_dm(state: PipelineState) -> dict[str, Any]:
    decision = interrupt({"phase": "data_modeler", "summary": state.get("summaries", {}).get("data_modeler")})
    return {"approvals": {**state.get("approvals", {}), "data_modeler": decision}}


async def _metric_architect(state: PipelineState) -> dict[str, Any]:
    res = await phase_metric_architect(state["project_id"])
    return {"summaries": {**state.get("summaries", {}), "metric_architect": res}}


def _review_ma(state: PipelineState) -> dict[str, Any]:
    decision = interrupt({"phase": "metric_architect", "summary": state.get("summaries", {}).get("metric_architect")})
    return {"approvals": {**state.get("approvals", {}), "metric_architect": decision}}


def _gate(phase: str):
    def decide(state: PipelineState) -> str:
        return "continue" if _approved(state.get("approvals", {}).get(phase)) else "stop"
    return decide


def build_pipeline_graph(checkpointer: BaseCheckpointSaver):
    g = StateGraph(PipelineState)
    g.add_node("data_engineer", _data_engineer)
    g.add_node("review_de", _review_de)
    g.add_node("data_modeler", _data_modeler)
    g.add_node("review_dm", _review_dm)
    g.add_node("metric_architect", _metric_architect)
    g.add_node("review_ma", _review_ma)

    g.add_edge(START, "data_engineer")
    g.add_edge("data_engineer", "review_de")
    g.add_conditional_edges("review_de", _gate("data_engineer"), {"continue": "data_modeler", "stop": END})
    g.add_edge("data_modeler", "review_dm")
    g.add_conditional_edges("review_dm", _gate("data_modeler"), {"continue": "metric_architect", "stop": END})
    g.add_edge("metric_architect", "review_ma")
    g.add_edge("review_ma", END)

    return g.compile(checkpointer=checkpointer, name="genbi-pipeline")
