"""Metric Architect (Phase 3) routes — port of `project-metrics/index.ts`."""
from __future__ import annotations

import logging
import re
from functools import wraps
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Response
from fastapi.responses import JSONResponse

from ..agents.metric_architect.agent import run_metric_architect_suggest
from ..agents.metric_architect.prompt import build_metric_architect_prompt
from ..agents.shared.validation import SqlValidationError, assert_measure_formula
from ..db.introspection import warehouse_tables_with_columns
from ..db.repositories import metrics as repo
from ..db.repositories import semantic_models as sm_repo
from .common import load_project_or_404, parse_id

log = logging.getLogger("agents.routes.metrics")
router = APIRouter()

_METRIC_NAME = re.compile(r"^[a-z][a-z0-9_]{1,127}$")


def _is_missing_table(err: Exception) -> bool:
    return bool(re.search(r"relation .* does not exist", str(err), re.IGNORECASE))


def with_migration_guard(fn):
    @wraps(fn)
    async def inner(*args: Any, **kwargs: Any):
        try:
            return await fn(*args, **kwargs)
        except HTTPException:
            raise
        except Exception as err:  # noqa: BLE001
            if _is_missing_table(err):
                return JSONResponse(
                    status_code=503,
                    content={
                        "error": "Database schema is out of date. Run `pnpm db:push` to create the "
                                 "required tables, then restart the API server.",
                        "code": "SCHEMA_NOT_MIGRATED",
                    },
                )
            raise

    return inner


@router.post("/projects/{project_id}/agents/metric-architect/suggest")
@with_migration_guard
async def suggest(project_id: int):
    project_id = parse_id(project_id)
    project = await load_project_or_404(project_id)

    try:
        tables = await warehouse_tables_with_columns(project_id)
    except Exception as err:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(err))
    if not tables:
        raise HTTPException(
            status_code=400,
            detail="Warehouse is empty. Apply transformations in Data Engineering first.",
        )

    applied_sm = await sm_repo.get_applied_raw(project_id)
    semantic_graph = applied_sm["graph_definition"] if applied_sm else None
    existing = await repo.existing_summaries(project_id)

    system_prompt = build_metric_architect_prompt(
        project_id=project_id,
        project_name=project["name"],
        project_description=project.get("description"),
        warehouse_tables=tables,
        semantic_graph=semantic_graph,
        existing_metrics=existing,
    )

    try:
        result = await run_metric_architect_suggest(project_id, system_prompt)
    except Exception as err:  # noqa: BLE001
        log.exception("metric-architect suggest failed project=%s", project_id)
        raise HTTPException(status_code=500, detail=str(err))

    proposed = await repo.list_proposed(project_id, limit=40)
    return {
        "iterations": result["iterations"],
        "toolCalls": result["toolCallsByName"],
        "finalText": result["finalText"],
        "proposedCount": result["toolCallsByName"].get("save_measure_metadata", 0),
        "metrics": proposed,
    }


@router.get("/projects/{project_id}/metrics")
@with_migration_guard
async def list_metrics(project_id: int):
    project_id = parse_id(project_id)
    return {"metrics": await repo.list_by_project(project_id)}


@router.post("/projects/{project_id}/metrics/{mid}/accept")
async def accept(project_id: int, mid: int):
    project_id, mid = parse_id(project_id), parse_id(mid)
    updated = await repo.set_status(project_id, mid, "applied")
    if not updated:
        raise HTTPException(status_code=404, detail="Metric not found")
    return {"ok": True, "status": "applied", "metric": updated}


@router.post("/projects/{project_id}/metrics/{mid}/reject")
async def reject(project_id: int, mid: int):
    project_id, mid = parse_id(project_id), parse_id(mid)
    await repo.set_status(project_id, mid, "rejected")
    return {"ok": True, "status": "rejected"}


@router.delete("/projects/{project_id}/metrics/{mid}", status_code=204)
async def delete(project_id: int, mid: int):
    project_id, mid = parse_id(project_id), parse_id(mid)
    await repo.delete(project_id, mid)
    return Response(status_code=204)


@router.patch("/projects/{project_id}/metrics/{mid}")
async def patch(project_id: int, mid: int, body: dict[str, Any] = Body(default={})):
    project_id, mid = parse_id(project_id), parse_id(mid)
    updates: dict[str, Any] = {}

    if isinstance(body.get("metricName"), str):
        name = body["metricName"].strip()
        if not _METRIC_NAME.match(name):
            raise HTTPException(status_code=400, detail="metricName must be snake_case, start with a letter, ≤128 chars.")
        updates["metric_name"] = name
    if isinstance(body.get("description"), str):
        updates["description"] = body["description"][:2000]
    if isinstance(body.get("sqlFormula"), str):
        try:
            assert_measure_formula(body["sqlFormula"])
        except SqlValidationError as err:
            raise HTTPException(status_code=400, detail=str(err))
        updates["sql_formula"] = body["sqlFormula"]
    if isinstance(body.get("dependsOnTables"), list):
        updates["depends_on_tables"] = [str(x) for x in body["dependsOnTables"]]

    updated = await repo.patch(project_id, mid, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Metric not found")
    return {"metric": updated}
