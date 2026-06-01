"""Subagent runner helpers — thin wrappers over the shared ReAct builder so each
auto-pipeline subagent looks the same: build a graph on a fresh thread, run the
ReAct loop, and capture the agent's structured result via a `submit_*` tool.
"""
from __future__ import annotations

import logging
from typing import Any, Type

from langchain_core.tools import StructuredTool
from pydantic import BaseModel

from ...checkpoint.saver import get_saver
from ..shared.react import build_agent_graph, new_thread_id, run_agent
from ..shared.serde import dumps

log = logging.getLogger("agents.auto_pipeline")


def make_submit_tool(
    *, name: str, description: str, model: Type[BaseModel], holder: dict[str, Any]
) -> StructuredTool:
    """A tool the agent calls exactly once to hand back its structured result.
    Writes the validated payload into `holder` (a closure dict the caller reads)."""

    async def submit(**kwargs: Any) -> str:
        obj = model(**kwargs)
        holder.clear()
        holder.update(obj.model_dump())
        return dumps({"received": True})

    return StructuredTool.from_function(
        coroutine=submit, name=name, args_schema=model, description=description
    )


async def run_subagent(
    *,
    name: str,
    project_id: int,
    system_prompt: str,
    user_message: str,
    tools: list[StructuredTool],
    max_iterations: int = 8,
    max_tokens: int = 4096,
) -> dict[str, Any]:
    graph = build_agent_graph(tools, get_saver(), max_tokens=max_tokens, name=name)
    thread = new_thread_id(name, project_id)
    try:
        return await run_agent(
            graph, system_prompt=system_prompt, user_message=user_message,
            thread_id=thread, max_iterations=max_iterations,
        )
    except Exception as err:  # noqa: BLE001
        log.exception("auto subagent %s failed project=%s", name, project_id)
        return {"finalText": f"[{name} error] {err}", "iterations": 0, "toolCallCount": 0, "toolCallsByName": {}}
