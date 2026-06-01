"""Shared agent routes — preview-prompt + analyst-chat SSE streaming.

Ports `project-agents/index.ts` (preview-prompt) and implements the analyst-chat
/messages SSE endpoint that was a stub in the Express codebase.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.utils.function_calling import convert_to_openai_tool

from ..agents.analyst_chat.agent import stream_analyst_chat
from ..agents.analyst_chat.prompt import build_analyst_chat_prompt
from ..agents.analyst_chat.tools import make_analyst_chat_tools
from ..agents.data_engineer.prompt import build_data_engineer_prompt
from ..agents.data_engineer.tools import make_data_engineer_tools
from ..agents.data_modeler.prompt import build_data_modeler_semantic_prompt
from ..agents.data_modeler.tools import make_semantic_tools
from ..agents.shared.serde import dumps
from ..db.introspection import warehouse_tables_with_columns
from ..db.repositories import semantic_models as sm_repo
from ..db.schemas import get_project_schema_name, list_warehouse_tables
from .common import load_project_or_404, parse_id

log = logging.getLogger("agents.routes.agents")
router = APIRouter()

_AGENTS = {"data-engineer", "data-modeler", "analyst-chat"}


def _openai_tools(tools) -> list[dict]:
    return [convert_to_openai_tool(t) for t in tools]


def _split_table_column(qualified: str) -> dict[str, str]:
    idx = qualified.rfind(".")
    if idx == -1:
        return {"table": qualified, "column": ""}
    return {"table": qualified[:idx], "column": qualified[idx + 1:]}


async def _relationships_for(project_id: int) -> list[dict[str, str]]:
    """Legacy {sourceTable,sourceColumn,targetTable,targetColumn} from applied joins."""
    applied = await sm_repo.get_applied_raw(project_id)
    if not applied:
        return []
    out = []
    for j in (applied["graph_definition"] or {}).get("joins") or []:
        src = _split_table_column(j["from"])
        tgt = _split_table_column(j["to"])
        out.append({
            "sourceTable": src["table"], "sourceColumn": src["column"],
            "targetTable": tgt["table"], "targetColumn": tgt["column"],
        })
    return out


@router.get("/projects/{project_id}/agents/{agent}/preview-prompt")
async def preview_prompt(project_id: int, agent: str):
    project_id = parse_id(project_id)
    if agent not in _AGENTS:
        raise HTTPException(status_code=400, detail="Unknown agent")

    project = await load_project_or_404(project_id)
    warehouse_schema = get_project_schema_name(project_id, "warehouse")

    warehouse_tables = []
    try:
        raw = await list_warehouse_tables(project_id)
        warehouse_tables = [{"tableName": t["tableName"], "columns": [], "rowCount": t["rowCount"]} for t in raw]
    except Exception:  # noqa: BLE001
        pass  # legacy workspace may not have the schema yet

    if agent == "data-engineer":
        system_prompt = build_data_engineer_prompt(
            project_id=project_id, project_name=project["name"],
            project_description=project.get("description"), raw_tables=[],
        )
        tools = make_data_engineer_tools(project_id)
    elif agent == "data-modeler":
        system_prompt = build_data_modeler_semantic_prompt(
            project_id=project_id, project_name=project["name"],
            project_description=project.get("description"),
            warehouse_tables=warehouse_tables, existing_graph=None,
        )
        tools = make_semantic_tools(project_id)
    else:
        system_prompt = build_analyst_chat_prompt(
            project_id=project_id, project_name=project["name"],
            project_description=project.get("description"),
            warehouse_tables=warehouse_tables, relationships=[],
        )
        tools = make_analyst_chat_tools(project_id)

    return {
        "agent": agent,
        "projectId": project_id,
        "warehouseSchema": warehouse_schema,
        "systemPrompt": system_prompt,
        "promptLineCount": len(system_prompt.split("\n")),
        "tools": _openai_tools(tools),
    }


@router.post("/projects/{project_id}/agents/analyst-chat/messages")
async def analyst_chat_messages(project_id: int, body: dict = Body(default={})):
    project_id = parse_id(project_id)
    project = await load_project_or_404(project_id)

    message = (body.get("message") or "").strip() if isinstance(body, dict) else ""
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    try:
        warehouse_tables = await warehouse_tables_with_columns(project_id)
    except Exception:  # noqa: BLE001
        warehouse_tables = []
    relationships = await _relationships_for(project_id)

    system_prompt = build_analyst_chat_prompt(
        project_id=project_id, project_name=project["name"],
        project_description=project.get("description"),
        warehouse_tables=warehouse_tables, relationships=relationships,
    )

    async def event_stream():
        try:
            async for evt in stream_analyst_chat(project_id, system_prompt, message):
                yield f"data: {dumps(evt)}\n\n"
        except Exception as err:  # noqa: BLE001
            log.exception("analyst-chat stream failed project=%s", project_id)
            yield f"data: {dumps({'type': 'error', 'message': str(err)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )
