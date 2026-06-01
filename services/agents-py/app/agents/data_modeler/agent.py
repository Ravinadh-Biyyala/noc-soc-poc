"""Data Modeler agent runners — semantic-model pass and dashboard-generation pass."""
from __future__ import annotations

from typing import Any

from ...checkpoint.saver import get_saver
from ..shared.react import build_agent_graph, new_thread_id, run_agent
from .tools import make_dashboard_tools, make_semantic_tools

SEMANTIC_USER_MESSAGE = "\n".join(
    [
        "Design the semantic graph for this project:",
        "1. Call propose_star_schema with the fact/dimension classification.",
        "2. Call generate_semantic_graph with the facts, dimensions, and joins.",
        "3. Stop after generate_semantic_graph records the row.",
    ]
)

DASHBOARD_USER_MESSAGE = "\n".join(
    [
        "Design a project dashboard now:",
        "1. Query the warehouse for the numbers you'll plot (execute_warehouse_query, several calls).",
        "2. Pick 4–6 chart types that together answer the project's goal.",
        "3. Call create_dashboard ONCE with all the charts. Stop after that.",
    ]
)


async def run_semantic_suggest(project_id: int, system_prompt: str) -> dict[str, Any]:
    tools = make_semantic_tools(project_id)
    graph = build_agent_graph(tools, get_saver(), max_tokens=4096, name="data-modeler-semantic")
    thread = new_thread_id("data-modeler-semantic", project_id)
    return await run_agent(
        graph, system_prompt=system_prompt, user_message=SEMANTIC_USER_MESSAGE,
        thread_id=thread, max_iterations=6,
    )


async def run_generate_dashboard(project_id: int, system_prompt: str) -> dict[str, Any]:
    tools = make_dashboard_tools(project_id)
    graph = build_agent_graph(tools, get_saver(), max_tokens=6000, name="data-modeler-dashboard")
    thread = new_thread_id("data-modeler-dashboard", project_id)
    return await run_agent(
        graph, system_prompt=system_prompt, user_message=DASHBOARD_USER_MESSAGE,
        thread_id=thread, max_iterations=12,
    )
