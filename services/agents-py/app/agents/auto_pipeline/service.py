"""SSE runner for the auto-mode pipeline.

Drives the orchestrator graph with stream_mode="updates" and translates each
node's delta into a progress event the frontend can render live. Mirrors the
analyst-chat streaming shape.
"""
from __future__ import annotations

import logging
from typing import Any, AsyncIterator

from ..shared.react import new_thread_id
from .graph import build_auto_pipeline_graph
from .state import ANALYSIS_LENSES

log = logging.getLogger("agents.auto_pipeline")

_PHASE_LABEL = {
    "profiler": "Profiling raw data",
    "cleaning": "Cleaning & type-checking",
    "merging": "Merging tables",
    "visualization": "Designing charts",
    "assemble": "Building dashboard & report",
}


def _plan() -> list[dict[str, str]]:
    phases = [
        {"id": "profiler", "label": _PHASE_LABEL["profiler"]},
        {"id": "cleaning", "label": _PHASE_LABEL["cleaning"]},
        {"id": "merging", "label": _PHASE_LABEL["merging"]},
        {"id": "analysis", "label": "Analysis (5 lenses in parallel)"},
        {"id": "visualization", "label": _PHASE_LABEL["visualization"]},
        {"id": "assemble", "label": _PHASE_LABEL["assemble"]},
    ]
    return phases


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
                delta = delta or {}
                if node == "profiler":
                    prof = delta.get("profile") or {}
                    yield {"type": "phase", "name": "profiler", "status": "done", "detail": prof.get("summary", "")}
                elif node == "cleaning":
                    cl = delta.get("cleaned") or {}
                    yield {"type": "phase", "name": "cleaning", "status": "done",
                           "detail": cl.get("summary", ""), "tables": len(cl.get("tables") or [])}
                elif node == "merging":
                    mg = delta.get("merge") or {}
                    yield {"type": "phase", "name": "merging", "status": "done",
                           "detail": mg.get("summary", ""), "strategy": mg.get("strategy", "")}
                elif node.startswith("analysis_"):
                    findings = delta.get("findings") or {}
                    for lens, f in findings.items():
                        yield {"type": "finding", "lens": lens, "summary": (f or {}).get("summary", "")}
                elif node == "visualization":
                    charts = delta.get("charts") or []
                    chart_count = len(charts)
                    yield {"type": "phase", "name": "visualization", "status": "done", "charts": chart_count}
                elif node == "assemble":
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
