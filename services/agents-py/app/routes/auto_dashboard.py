"""Auto-mode dashboard generation route (SSE).

POST /api/projects/{id}/dashboards/auto-generate streams the multiagent
pipeline's progress and finishes with {dashboardId, report}. The path sits under
the `dashboards` group, so the Express proxy forwards it unchanged.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..agents.auto_pipeline.service import stream_auto_dashboard
from ..agents.shared.serde import dumps
from ..db.schemas import list_raw_tables
from .common import load_project_or_404, parse_id

log = logging.getLogger("agents.routes.auto_dashboard")
router = APIRouter()


@router.post("/projects/{project_id}/dashboards/auto-generate")
async def auto_generate_dashboard(project_id: int):
    project_id = parse_id(project_id)
    project = await load_project_or_404(project_id)

    try:
        raw = await list_raw_tables(project_id)
    except Exception:  # noqa: BLE001
        raw = []
    if not raw:
        raise HTTPException(
            status_code=400,
            detail="No raw data to analyse. Connect/import data before generating a dashboard.",
        )

    async def event_stream():
        try:
            async for evt in stream_auto_dashboard(
                project_id, project["name"], project.get("description")
            ):
                yield f"data: {dumps(evt)}\n\n"
        except Exception as err:  # noqa: BLE001
            log.exception("auto-generate stream failed project=%s", project_id)
            yield f"data: {dumps({'type': 'error', 'message': str(err)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )
