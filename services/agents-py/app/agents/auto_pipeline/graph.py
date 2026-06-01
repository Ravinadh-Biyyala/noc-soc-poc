"""Auto-mode orchestrator graph.

    START -> profiler -> cleaning -> merging -> [5 analysis lenses in parallel]
          -> visualization (barrier) -> assemble -> END

The 5 lens nodes fan out from `merging` and fan back into `visualization`;
LangGraph runs them concurrently and `visualization` only fires once all five
have completed (multiple incoming edges act as a barrier). Each lens writes to
the reducer-backed `findings` channel, so concurrent writes merge safely.
"""
from __future__ import annotations

import logging
from typing import Any

from langgraph.graph import END, START, StateGraph

from ...checkpoint.saver import get_saver
from ..data_modeler.dashboards import create_project_dashboard
from .analysis import run_analysis_lens
from .cleaning import run_cleaning
from .merging import run_merging
from .profiler import run_profiler
from .report import assemble_report
from .state import ANALYSIS_LENSES, AutoPipelineState
from .visualization import run_visualization

log = logging.getLogger("agents.auto_pipeline")


def _lens_node(lens: str):
    async def node(state: AutoPipelineState) -> dict[str, Any]:
        return await run_analysis_lens(dict(state), lens)

    node.__name__ = f"analysis_{lens}"
    return node


async def _profiler_node(state: AutoPipelineState) -> dict[str, Any]:
    return await run_profiler(dict(state))


async def _cleaning_node(state: AutoPipelineState) -> dict[str, Any]:
    return await run_cleaning(dict(state))


async def _merging_node(state: AutoPipelineState) -> dict[str, Any]:
    return await run_merging(dict(state))


async def _visualization_node(state: AutoPipelineState) -> dict[str, Any]:
    return await run_visualization(dict(state))


async def _assemble_node(state: AutoPipelineState) -> dict[str, Any]:
    s = dict(state)
    report = assemble_report(s)
    charts = s.get("charts") or []
    title = f"{s.get('project_name') or 'Project'} — Auto Dashboard"
    try:
        res = await create_project_dashboard(s["project_id"], title, charts, report_md=report)
    except Exception as err:  # noqa: BLE001
        log.exception("assemble: create_project_dashboard failed project=%s", s.get("project_id"))
        return {"report": report, "errors": [f"assemble: {err}"]}

    if "error" in res:
        return {"report": report, "errors": [f"assemble: {res['error']}"]}
    return {"report": report, "dashboard_id": res.get("dashboardId")}


def build_auto_pipeline_graph():
    g = StateGraph(AutoPipelineState)
    g.add_node("profiler", _profiler_node)
    g.add_node("cleaning", _cleaning_node)
    g.add_node("merging", _merging_node)
    for lens in ANALYSIS_LENSES:
        g.add_node(f"analysis_{lens}", _lens_node(lens))
    g.add_node("visualization", _visualization_node)
    g.add_node("assemble", _assemble_node)

    g.add_edge(START, "profiler")
    g.add_edge("profiler", "cleaning")
    g.add_edge("cleaning", "merging")
    for lens in ANALYSIS_LENSES:
        g.add_edge("merging", f"analysis_{lens}")        # fan-out
        g.add_edge(f"analysis_{lens}", "visualization")  # fan-in (barrier)
    g.add_edge("visualization", "assemble")
    g.add_edge("assemble", END)

    return g.compile(checkpointer=get_saver(), name="auto-dashboard-pipeline")
