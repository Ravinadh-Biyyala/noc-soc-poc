"""Analyst Chat agent — a streaming ReAct graph.

This is a NEW capability: in the Express codebase the analyst-chat /messages
endpoint and ChatPanel were stubs. Here it streams tokens (and runs its
read-only warehouse-query tool) via LangGraph's astream_events.
"""
from __future__ import annotations

from typing import AsyncIterator

from langchain_core.messages import HumanMessage, SystemMessage

from ...checkpoint.saver import get_saver
from ..shared.react import build_agent_graph, new_thread_id
from .tools import make_analyst_chat_tools


async def stream_analyst_chat(
    project_id: int, system_prompt: str, user_message: str
) -> AsyncIterator[dict]:
    tools = make_analyst_chat_tools(project_id)
    graph = build_agent_graph(tools, get_saver(), max_tokens=4096, name="analyst-chat", streaming=True)
    thread = new_thread_id("analyst-chat", project_id)
    config = {"configurable": {"thread_id": thread}, "recursion_limit": 13}
    init = {"messages": [SystemMessage(content=system_prompt), HumanMessage(content=user_message)]}

    async for event in graph.astream_events(init, config=config, version="v2"):
        kind = event["event"]
        if kind == "on_chat_model_stream":
            chunk = event["data"]["chunk"]
            text = chunk.content if isinstance(chunk.content, str) else ""
            if text:
                yield {"type": "token", "value": text}
        elif kind == "on_tool_start":
            yield {"type": "tool", "name": event.get("name", "")}
    yield {"type": "done"}
