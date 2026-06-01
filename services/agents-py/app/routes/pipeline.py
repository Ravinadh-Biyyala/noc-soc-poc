"""Orchestrated pipeline routes — runs the three phases with human-in-the-loop
interrupts. Separate from the discrete /suggest + /accept contract.

  POST /projects/{id}/pipeline/start            -> runs phase 1, pauses for approval
  POST /projects/{id}/pipeline/resume {decision}-> approves/rejects, advances
  GET  /projects/{id}/pipeline/state            -> current checkpoint snapshot
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body
from langgraph.types import Command

from ..agents.pipeline.graph import build_pipeline_graph
from ..checkpoint.saver import get_saver
from .common import load_project_or_404, parse_id

router = APIRouter()


def _config(project_id: int) -> dict[str, Any]:
    return {"configurable": {"thread_id": f"pipeline:{project_id}"}, "recursion_limit": 50}


def _interrupt_or_done(result: dict[str, Any]) -> dict[str, Any]:
    interrupts = result.get("__interrupt__")
    if interrupts:
        return {"status": "interrupted", "interrupt": interrupts[0].value}
    return {
        "status": "done",
        "summaries": result.get("summaries", {}),
        "approvals": result.get("approvals", {}),
    }


@router.post("/projects/{project_id}/pipeline/start")
async def start(project_id: int):
    project_id = parse_id(project_id)
    await load_project_or_404(project_id)
    graph = build_pipeline_graph(get_saver())
    result = await graph.ainvoke(
        {"project_id": project_id, "summaries": {}, "approvals": {}}, config=_config(project_id)
    )
    return _interrupt_or_done(result)


@router.post("/projects/{project_id}/pipeline/resume")
async def resume(project_id: int, body: dict = Body(default={})):
    project_id = parse_id(project_id)
    decision = body.get("decision", {"approved": True}) if isinstance(body, dict) else {"approved": True}
    graph = build_pipeline_graph(get_saver())
    result = await graph.ainvoke(Command(resume=decision), config=_config(project_id))
    return _interrupt_or_done(result)


@router.get("/projects/{project_id}/pipeline/state")
async def state(project_id: int):
    project_id = parse_id(project_id)
    graph = build_pipeline_graph(get_saver())
    snapshot = await graph.aget_state(_config(project_id))
    return {
        "values": snapshot.values,
        "next": list(snapshot.next),
        "interrupts": [i.value for t in snapshot.tasks for i in t.interrupts],
    }
