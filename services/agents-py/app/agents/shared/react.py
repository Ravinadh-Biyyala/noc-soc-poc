"""Idiomatic LangGraph replacement for `src/agents/shared/runner.ts`.

`runAgent` was a hand-rolled OpenAI tool-calling loop. Here it becomes a
compiled `StateGraph` over `MessagesState`: an ``agent`` node (the LLM bound to
the agent's tools) and a ``tools`` node (`ToolNode`), looped via
`tools_condition`. `recursion_limit` replaces `maxIterations`.

`run_agent` invokes the graph, then derives the same summary shape the TS
routes return (``finalText`` / ``iterations`` / ``toolCallCount`` /
``toolCallsByName``) by walking the resulting message list.
"""
from __future__ import annotations

import uuid
from typing import Any, Sequence

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.tools import BaseTool
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from ...llm.client import make_chat_model


def build_agent_graph(
    tools: Sequence[BaseTool],
    checkpointer: BaseCheckpointSaver,
    *,
    max_tokens: int | None = None,
    name: str = "agent",
    streaming: bool = False,
):
    """Compile a ReAct-style tool-calling graph for one agent."""
    model = make_chat_model(max_tokens=max_tokens, streaming=streaming).bind_tools(list(tools))

    async def agent_node(state: MessagesState) -> dict[str, Any]:
        response = await model.ainvoke(state["messages"])
        return {"messages": [response]}

    builder = StateGraph(MessagesState)
    builder.add_node("agent", agent_node)
    builder.add_node("tools", ToolNode(list(tools)))
    builder.add_edge(START, "agent")
    builder.add_conditional_edges("agent", tools_condition)
    builder.add_edge("tools", "agent")
    return builder.compile(checkpointer=checkpointer, name=name)


def new_thread_id(agent: str, project_id: int) -> str:
    """Fresh thread per /suggest run — keeps each LangSmith trace self-contained
    and avoids message accumulation across runs on the same project."""
    return f"{agent}:{project_id}:{uuid.uuid4()}"


async def run_agent(
    graph,
    *,
    system_prompt: str,
    user_message: str,
    thread_id: str,
    max_iterations: int = 6,
) -> dict[str, Any]:
    # Each agent <-> tools cycle is two super-steps; +1 for the final answer.
    config = {
        "configurable": {"thread_id": thread_id},
        "recursion_limit": max_iterations * 2 + 1,
    }
    init = {"messages": [SystemMessage(content=system_prompt), HumanMessage(content=user_message)]}

    result = await graph.ainvoke(init, config=config)
    messages = result["messages"]

    final_text = ""
    iterations = 0
    tool_call_count = 0
    tool_calls_by_name: dict[str, int] = {}

    for msg in messages:
        if isinstance(msg, AIMessage):
            iterations += 1
            if msg.content:
                # content may be a string or a list of content blocks
                final_text = msg.content if isinstance(msg.content, str) else final_text
            for call in msg.tool_calls or []:
                tool_call_count += 1
                tool_calls_by_name[call["name"]] = tool_calls_by_name.get(call["name"], 0) + 1

    return {
        "finalText": final_text,
        "iterations": iterations,
        "toolCallCount": tool_call_count,
        "toolCallsByName": tool_calls_by_name,
    }
