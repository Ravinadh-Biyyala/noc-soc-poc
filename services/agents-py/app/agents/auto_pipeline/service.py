"""SSE runner for the auto-mode pipeline (and the guided HITL variant).

Drives the orchestrator graph with stream_mode="updates" and translates each
node's delta into a progress event the frontend can render live. Mirrors the
analyst-chat streaming shape.

Guided mode splits into two calls because SSE is one-directional:
  - `start_guided`  : runs profiler + question generation, pauses at `interview`,
                      returns the questions (the interrupt payload).
  - `stream_guided_resume` : resumes with the user's answers and SSE-streams the
                      cleaning -> assemble back half.
Both share the checkpointer thread `guided:{project_id}:{session}`, so the
profile/questions/intent persist across the two HTTP requests.
"""
from __future__ import annotations

import logging
from typing import Any, AsyncIterator

from langgraph.types import Command

from ..shared.react import new_thread_id
from .graph import build_auto_pipeline_graph
from .state import ANALYSIS_LENSES

log = logging.getLogger("agents.auto_pipeline")

_PHASE_LABEL = {
    "profiler": "Profiling raw data",
    "cleaning": "Cleaning & type-checking",
    "merging": "Merging tables",
    "kpi_builder": "Building KPIs from your intent",
    "visualization": "Designing charts",
    "assemble": "Building dashboard & report",
}


def _plan(*, guided: bool = False) -> list[dict[str, str]]:
    phases = [
        {"id": "profiler", "label": _PHASE_LABEL["profiler"]},
        {"id": "cleaning", "label": _PHASE_LABEL["cleaning"]},
        {"id": "merging", "label": _PHASE_LABEL["merging"]},
    ]
    if guided:
        phases.append({"id": "kpi_builder", "label": _PHASE_LABEL["kpi_builder"]})
    phases += [
        {"id": "analysis", "label": "Analysis (5 lenses in parallel)"},
        {"id": "visualization", "label": _PHASE_LABEL["visualization"]},
        {"id": "assemble", "label": _PHASE_LABEL["assemble"]},
    ]
    return phases


def _node_events(node: str, delta: dict[str, Any]) -> list[dict[str, Any]]:
    """Translate one node's state delta into frontend progress events."""
    delta = delta or {}
    out: list[dict[str, Any]] = []
    if node == "profiler":
        prof = delta.get("profile") or {}
        out.append({"type": "phase", "name": "profiler", "status": "done", "detail": prof.get("summary", "")})
    elif node == "cleaning":
        cl = delta.get("cleaned") or {}
        out.append({"type": "phase", "name": "cleaning", "status": "done",
                    "detail": cl.get("summary", ""), "tables": len(cl.get("tables") or [])})
    elif node == "merging":
        mg = delta.get("merge") or {}
        out.append({"type": "phase", "name": "merging", "status": "done",
                    "detail": mg.get("summary", ""), "strategy": mg.get("strategy", "")})
    elif node == "kpi_builder":
        kp = delta.get("kpis") or {}
        out.append({"type": "phase", "name": "kpi_builder", "status": "done",
                    "detail": kp.get("summary", ""), "table": kp.get("table", "")})
    elif node.startswith("analysis_"):
        findings = delta.get("findings") or {}
        for lens, f in findings.items():
            out.append({"type": "finding", "lens": lens, "summary": (f or {}).get("summary", "")})
    elif node == "visualization":
        charts = delta.get("charts") or []
        out.append({"type": "phase", "name": "visualization", "status": "done", "charts": len(charts)})
    return out


async def stream_auto_dashboard(
    project_id: int, project_name: str, project_description: str | None
) -> AsyncIterator[dict[str, Any]]:
    graph = build_auto_pipeline_graph()
    thread = new_thread_id("auto-pipeline", project_id)
    config = {"configurable": {"thread_id": thread}, "recursion_limit": 80}
    init = {
        "project_id": project_id,
        "project_name": project_name,
        "project_description": project_description,
    }

    yield {"type": "plan", "phases": _plan(), "lenses": ANALYSIS_LENSES}

    dashboard_id: int | None = None
    report: str = ""
    chart_count = 0

    try:
        async for update in graph.astream(init, config=config, stream_mode="updates"):
            if not isinstance(update, dict):
                continue
            for node, delta in update.items():
                for evt in _node_events(node, delta or {}):
                    if evt.get("name") == "visualization":
                        chart_count = evt.get("charts", 0)
                    yield evt
                if node == "assemble":
                    delta = delta or {}
                    report = delta.get("report") or report
                    if delta.get("dashboard_id"):
                        dashboard_id = delta["dashboard_id"]
                    for e in delta.get("errors") or []:
                        yield {"type": "warning", "message": e}
    except Exception as err:  # noqa: BLE001
        log.exception("auto dashboard pipeline failed project=%s", project_id)
        yield {"type": "error", "message": str(err)}
        return

    if dashboard_id is None:
        yield {"type": "error", "message": "Dashboard could not be generated from the available data."}
        return

    yield {"type": "done", "dashboardId": dashboard_id, "report": report, "charts": chart_count}


def _guided_config(project_id: int, session: str) -> dict[str, Any]:
    return {"configurable": {"thread_id": f"guided:{project_id}:{session}"}, "recursion_limit": 80}


async def start_guided(
    project_id: int, project_name: str, project_description: str | None, session: str
) -> dict[str, Any]:
    """Run profiler + question generation, then pause at the interview interrupt.
    Returns the questions for the user to answer."""
    graph = build_auto_pipeline_graph(guided=True)
    config = _guided_config(project_id, session)
    init = {
        "project_id": project_id,
        "project_name": project_name,
        "project_description": project_description,
    }
    result = await graph.ainvoke(init, config=config)

    interrupts = result.get("__interrupt__") if isinstance(result, dict) else None
    if interrupts:
        payload = interrupts[0].value or {}
        return {
            "status": "interrupted",
            "session": session,
            "questions": payload.get("questions") or [],
            "profileSummary": (result.get("profile") or {}).get("summary", ""),
        }
    # No interrupt (shouldn't happen in guided mode) — report done so the caller
    # can fall back gracefully.
    return {"status": "done", "session": session, "questions": []}


async def stream_guided_resume(
    project_id: int, session: str, answers: dict[str, Any]
) -> AsyncIterator[dict[str, Any]]:
    """Resume the paused guided pipeline with the user's answers and stream the
    cleaning -> assemble back half."""
    graph = build_auto_pipeline_graph(guided=True)
    config = _guided_config(project_id, session)

    # Profiler already ran during start; mark it done in the plan.
    yield {"type": "plan", "phases": _plan(guided=True), "lenses": ANALYSIS_LENSES}
    yield {"type": "phase", "name": "profiler", "status": "done", "detail": ""}

    dashboard_id: int | None = None
    report: str = ""
    chart_count = 0

    try:
        async for update in graph.astream(
            Command(resume=answers or {}), config=config, stream_mode="updates"
        ):
            if not isinstance(update, dict):
                continue
            for node, delta in update.items():
                for evt in _node_events(node, delta or {}):
                    if evt.get("name") == "visualization":
                        chart_count = evt.get("charts", 0)
                    yield evt
                if node == "assemble":
                    delta = delta or {}
                    report = delta.get("report") or report
                    if delta.get("dashboard_id"):
                        dashboard_id = delta["dashboard_id"]
                    for e in delta.get("errors") or []:
                        yield {"type": "warning", "message": e}
    except Exception as err:  # noqa: BLE001
        log.exception("guided dashboard pipeline failed project=%s", project_id)
        yield {"type": "error", "message": str(err)}
        return

    if dashboard_id is None:
        yield {"type": "error", "message": "Dashboard could not be generated from the available data."}
        return

    yield {"type": "done", "dashboardId": dashboard_id, "report": report, "charts": chart_count}
