"""Metric Architect agent runner."""
from __future__ import annotations

from typing import Any

from ...checkpoint.saver import get_saver
from ..shared.react import build_agent_graph, new_thread_id, run_agent
from .tools import make_metric_architect_tools

USER_MESSAGE = "\n".join(
    [
        "Define business KPIs for this project:",
        "1. Call read_semantic_model to confirm the join graph.",
        "2. Call suggest_metrics once for inspiration.",
        "3. For each KPI you want to persist, call save_measure_metadata.",
        "4. Stop after 4–8 well-justified metrics.",
    ]
)


async def run_metric_architect_suggest(project_id: int, system_prompt: str) -> dict[str, Any]:
    tools = make_metric_architect_tools(project_id)
    graph = build_agent_graph(tools, get_saver(), max_tokens=4096, name="metric-architect")
    thread = new_thread_id("metric-architect", project_id)
    return await run_agent(
        graph, system_prompt=system_prompt, user_message=USER_MESSAGE,
        thread_id=thread, max_iterations=12,
    )
