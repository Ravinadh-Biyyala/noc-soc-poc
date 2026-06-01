"""Data Engineer (Phase 1) routes — port of `project-transformations/index.ts`."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import JSONResponse

from ..agents.data_engineer.agent import run_data_engineer_suggest
from ..agents.data_engineer.apply import apply_transformation
from ..agents.data_engineer.prompt import build_data_engineer_prompt
from ..db.introspection import columns_for_table
from ..db.repositories import transformations as repo
from ..db.schemas import create_project_schemas, list_raw_tables, raw_schema
from .common import load_project_or_404, parse_id

log = logging.getLogger("agents.routes.transformations")
router = APIRouter()


@router.post("/projects/{project_id}/agents/data-engineer/suggest")
async def suggest(project_id: int):
    project_id = parse_id(project_id)
    project = await load_project_or_404(project_id)

    try:
        await create_project_schemas(project_id)
    except Exception as err:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(err))

    schema = raw_schema(project_id)
    raw_tables = await list_raw_tables(project_id)
    if not raw_tables:
        raise HTTPException(
            status_code=400,
            detail="No raw tables yet — ingest data via the Connect tab before asking the agent.",
        )

    enriched = []
    for t in raw_tables:
        cols = await columns_for_table(schema, t["tableName"])
        enriched.append(
            {"tableName": t["tableName"], "rowCount": t["rowCount"],
             "columns": [{"name": c["name"], "type": c["type"]} for c in cols]}
        )

    system_prompt = build_data_engineer_prompt(
        project_id=project_id,
        project_name=project["name"],
        project_description=project.get("description"),
        raw_tables=enriched,
    )

    try:
        result = await run_data_engineer_suggest(project_id, system_prompt)
    except Exception as err:  # noqa: BLE001
        log.exception("data-engineer suggest failed project=%s", project_id)
        raise HTTPException(status_code=500, detail=str(err))

    proposals = await repo.list_proposed(project_id, limit=20)
    return {
        "iterations": result["iterations"],
        "toolCalls": result["toolCallsByName"],
        "finalText": result["finalText"],
        "proposedCount": result["toolCallsByName"].get("propose_cleaning", 0),
        "proposals": proposals,
    }


@router.get("/projects/{project_id}/transformations")
async def list_transformations(project_id: int):
    project_id = parse_id(project_id)
    return {"transformations": await repo.list_by_project(project_id)}


@router.post("/projects/{project_id}/transformations/{tid}/accept")
async def accept(project_id: int, tid: int):
    project_id, tid = parse_id(project_id), parse_id(tid)
    await repo.update_status(project_id, tid, "accepted")
    result = await apply_transformation(project_id, tid)
    if "error" in result:
        log.warning("transformation apply failed project=%s tid=%s err=%s", project_id, tid, result["error"])
        return JSONResponse(content={**result, "status": "accepted"}, status_code=400)
    return result


@router.post("/projects/{project_id}/transformations/{tid}/reject")
async def reject(project_id: int, tid: int):
    project_id, tid = parse_id(project_id), parse_id(tid)
    await repo.update_status(project_id, tid, "rejected")
    return {"ok": True}


@router.delete("/projects/{project_id}/transformations/{tid}", status_code=204)
async def delete(project_id: int, tid: int):
    project_id, tid = parse_id(project_id), parse_id(tid)
    await repo.delete(project_id, tid)
    return Response(status_code=204)
