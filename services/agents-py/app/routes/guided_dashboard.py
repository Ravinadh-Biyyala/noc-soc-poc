"""Guided-mode dashboard generation routes (human-in-the-loop).

  POST /api/projects/{id}/dashboards/guided/start   -> profiles data, returns intent questions
  POST /api/projects/{id}/dashboards/guided/resume  -> SSE; resumes with answers, builds the dashboard

Both paths sit under the `dashboards` group, so the Express proxy forwards them
unchanged. State persists across the two calls via the LangGraph checkpointer
keyed by thread `guided:{id}:{session}`.
"""
from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import StreamingResponse

from ..agents.auto_pipeline.service import start_guided, stream_guided_resume
from ..agents.shared.serde import dumps
from ..db.schemas import list_raw_tables
from .common import load_project_or_404, parse_id

log = logging.getLogger("agents.routes.guided_dashboard")
router = APIRouter()


async def _require_raw_data(project_id: int) -> None:
    try:
        raw = await list_raw_tables(project_id)
    except Exception:  # noqa: BLE001
        raw = []
    if not raw:
        raise HTTPException(
            status_code=400,
            detail="No raw data to analyse. Connect/import data before generating a dashboard.",
        )


@router.post("/projects/{project_id}/dashboards/guided/start")
async def guided_start(project_id: int):
    project_id = parse_id(project_id)
    project = await load_project_or_404(project_id)
    await _require_raw_data(project_id)

    session = uuid.uuid4().hex
    try:
        return await start_guided(project_id, project["name"], project.get("description"), session)
    except Exception as err:  # noqa: BLE001
        log.exception("guided start failed project=%s", project_id)
        raise HTTPException(status_code=500, detail=str(err))


@router.post("/projects/{project_id}/dashboards/guided/resume")
async def guided_resume(project_id: int, body: dict = Body(default={})):
    project_id = parse_id(project_id)
    await load_project_or_404(project_id)

    body = body if isinstance(body, dict) else {}
    session = str(body.get("session") or "").strip()
    answers = body.get("answers") if isinstance(body.get("answers"), dict) else {}
    if not session:
        raise HTTPException(status_code=400, detail="Missing session; call guided/start first.")

    async def event_stream():
        try:
            async for evt in stream_guided_resume(project_id, session, answers):
                yield f"data: {dumps(evt)}\n\n"
        except Exception as err:  # noqa: BLE001
            log.exception("guided resume stream failed project=%s", project_id)
            yield f"data: {dumps({'type': 'error', 'message': str(err)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )
