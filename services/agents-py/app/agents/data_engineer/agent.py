"""Data Engineer agent runner — compiles the ReAct graph and runs a suggest pass."""
from __future__ import annotations

from typing import Any

from ...checkpoint.saver import get_saver
from ..shared.react import build_agent_graph, new_thread_id, run_agent
from .tools import make_data_engineer_tools

USER_MESSAGE = "\n".join(
    [
        "The raw schema has been populated. Run the suggestion pass now:",
        "1. Call inspect_raw_table on each table you want to learn more about (focus on ones whose columns are ambiguous from the names alone).",
        "2. Propose up to 5 high-value transformations via propose_transformation. Mix of cleansing, joins, aggregations, and views.",
        "3. Do NOT call apply_transformation — the user reviews proposals before they execute.",
        "4. Stop after the proposals are recorded.",
    ]
)


async def run_data_engineer_suggest(project_id: int, system_prompt: str) -> dict[str, Any]:
    tools = make_data_engineer_tools(project_id)
    graph = build_agent_graph(tools, get_saver(), max_tokens=4096, name="data-engineer")
    thread = new_thread_id("data-engineer", project_id)
    return await run_agent(
        graph,
        system_prompt=system_prompt,
        user_message=USER_MESSAGE,
        thread_id=thread,
        max_iterations=8,
    )
