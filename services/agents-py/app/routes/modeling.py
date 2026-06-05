"""Data Modeler (Phase 2) routes — port of `project-modeling/index.ts`."""
from __future__ import annotations

import logging
import re
from functools import wraps
from typing import Any

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import JSONResponse

from ..agents.data_modeler.agent import run_generate_dashboard, run_semantic_suggest
from ..agents.data_modeler.prompt import (
    build_data_modeler_dashboard_prompt,
    build_data_modeler_semantic_prompt,
)
from ..agents.shared.validation import (
    SqlValidationError,
    assert_schema_scope,
    assert_select_only,
)
from ..db import pool as db
from ..db.introspection import warehouse_tables_with_columns
from ..db.repositories import dashboards as dash_repo
from ..db.repositories import semantic_models as sm_repo
from ..db.schemas import warehouse_schema
from .common import load_project_or_404, parse_id

log = logging.getLogger("agents.routes.modeling")
router = APIRouter()


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


def _kpi_format(title: str) -> str | None:
    if re.search(r"revenue|sales|amount|profit|income|spend|cost|price|value|total.*(\$|usd|aud|gbp|eur)", title, re.IGNORECASE):
        return "currency"
    if re.search(r"rate|ratio|percent|%", title, re.IGNORECASE):
        return "percent"
    return None


def _kpi_icon(title: str) -> str:
    if re.search(r"revenue|sales|amount|profit|income|spend|cost|price", title, re.IGNORECASE):
        return "DollarSign"
    if re.search(r"customer|user|owner|person|agent|member|employee|broker", title, re.IGNORECASE):
        return "Users"
    if re.search(r"rate|ratio|percent|%", title, re.IGNORECASE):
        return "Percent"
    if re.search(r"trend|growth|change", title, re.IGNORECASE):
        return "TrendingUp"
    if re.search(r"record|row|count|total", title, re.IGNORECASE):
        return "Hash"
    if re.search(r"policy|claim|risk|alert", title, re.IGNORECASE):
        return "ShieldAlert"
    return "BarChart3"


def _split_table_column(qualified: str) -> dict[str, str]:
    idx = qualified.rfind(".")
    if idx == -1:
        return {"table": qualified, "column": ""}
    return {"table": qualified[:idx], "column": qualified[idx + 1:]}


# ---------------------------------------------------------------------------
# Warehouse browsing
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}/warehouse-tables")
async def warehouse_tables(project_id: int):
    project_id = parse_id(project_id)
    try:
        return {"tables": await warehouse_tables_with_columns(project_id)}
    except Exception as err:  # noqa: BLE001
        log.warning("Failed to read warehouse project=%s err=%s", project_id, err)
        return {"tables": []}


# ---------------------------------------------------------------------------
# Phase 2 — suggest semantic model
# ---------------------------------------------------------------------------

async def _run_suggest_semantic_model(project_id: int):
    project = await load_project_or_404(project_id)

    try:
        tables = await warehouse_tables_with_columns(project_id)
    except Exception as err:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(err))

    if len(tables) < 2:
        raise HTTPException(
            status_code=400,
            detail="Need at least 2 warehouse tables before modeling. Apply more transformations first.",
        )

    existing_raw = await sm_repo.latest_raw(project_id)
    existing_graph = None
    if existing_raw:
        gd = existing_raw["graph_definition"] or {}
        existing_graph = {
            "facts": gd.get("facts") or [],
            "dimensions": gd.get("dimensions") or [],
            "joins": gd.get("joins") or [],
            "status": existing_raw["status"],
        }

    system_prompt = build_data_modeler_semantic_prompt(
        project_id=project_id,
        project_name=project["name"],
        project_description=project.get("description"),
        warehouse_tables=tables,
        existing_graph=existing_graph,
    )

    try:
        result = await run_semantic_suggest(project_id, system_prompt)
    except Exception as err:  # noqa: BLE001
        log.exception("data-modeler suggest failed project=%s", project_id)
        raise HTTPException(status_code=500, detail=str(err))

    proposed = await sm_repo.get_proposed(project_id)
    return {
        "iterations": result["iterations"],
        "toolCalls": result["toolCallsByName"],
        "finalText": result["finalText"],
        "semanticModel": proposed,
    }


@router.post("/projects/{project_id}/agents/data-modeler/suggest")
@with_migration_guard
async def suggest_semantic(project_id: int):
    return await _run_suggest_semantic_model(parse_id(project_id))


@router.post("/projects/{project_id}/agents/data-modeler/suggest-relationships")
@with_migration_guard
async def suggest_relationships(project_id: int):
    return await _run_suggest_semantic_model(parse_id(project_id))


# ---------------------------------------------------------------------------
# Semantic model CRUD
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}/semantic-model")
@with_migration_guard
async def list_semantic_models(project_id: int):
    project_id = parse_id(project_id)
    return {"semanticModels": await sm_repo.list_by_project(project_id)}


@router.post("/projects/{project_id}/semantic-model/{sm_id}/accept")
async def accept_semantic(project_id: int, sm_id: int):
    project_id, sm_id = parse_id(project_id), parse_id(sm_id)
    await sm_repo.demote_applied(project_id)
    updated = await sm_repo.set_status(project_id, sm_id, "applied")
    if not updated:
        raise HTTPException(status_code=404, detail="Semantic model not found in this project")
    return {"ok": True, "status": "applied", "semanticModel": updated}


@router.post("/projects/{project_id}/semantic-model/{sm_id}/reject")
async def reject_semantic(project_id: int, sm_id: int):
    project_id, sm_id = parse_id(project_id), parse_id(sm_id)
    await sm_repo.set_status(project_id, sm_id, "rejected")
    return {"ok": True, "status": "rejected"}


@router.delete("/projects/{project_id}/semantic-model/{sm_id}", status_code=204)
async def delete_semantic(project_id: int, sm_id: int):
    project_id, sm_id = parse_id(project_id), parse_id(sm_id)
    await sm_repo.delete(project_id, sm_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Legacy /relationships projection
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}/relationships")
@with_migration_guard
async def relationships(project_id: int):
    project_id = parse_id(project_id)
    rows = await sm_repo.list_by_project(project_id)
    out: list[dict[str, Any]] = []
    for sm in rows:
        for i, j in enumerate((sm["graphDefinition"] or {}).get("joins") or []):
            src = _split_table_column(j["from"])
            tgt = _split_table_column(j["to"])
            out.append(
                {
                    "id": sm["id"] * 100 + i,
                    "sourceTable": src["table"],
                    "sourceColumn": src["column"],
                    "targetTable": tgt["table"],
                    "targetColumn": tgt["column"],
                    "cardinality": j["cardinality"],
                    "status": sm["status"],
                    "agentRationale": sm["agentRationale"],
                    "createdAt": sm["createdAt"],
                }
            )
    return {"relationships": out}


# ---------------------------------------------------------------------------
# Phase 2B — generate dashboard
# ---------------------------------------------------------------------------

@router.post("/projects/{project_id}/agents/data-modeler/generate-dashboard")
async def generate_dashboard(project_id: int):
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

    system_prompt = build_data_modeler_dashboard_prompt(
        project_id=project_id,
        project_name=project["name"],
        project_description=project.get("description"),
        warehouse_tables=tables,
        semantic_graph=semantic_graph,
    )

    try:
        result = await run_generate_dashboard(project_id, system_prompt)
    except Exception as err:  # noqa: BLE001
        log.exception("data-modeler generate-dashboard failed project=%s", project_id)
        raise HTTPException(status_code=500, detail=str(err))

    return {
        "iterations": result["iterations"],
        "toolCalls": result["toolCallsByName"],
        "finalText": result["finalText"],
        "created": result["toolCallsByName"].get("create_dashboard", 0) > 0,
    }


# ---------------------------------------------------------------------------
# Project dashboards (list + get + delete)
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}/dashboards")
async def list_dashboards(project_id: int):
    project_id = parse_id(project_id)
    return {"dashboards": await dash_repo.list_project_dashboards(project_id)}


@router.get("/projects/{project_id}/dashboards/{dash_id}")
async def get_dashboard(project_id: int, dash_id: int):
    project_id, dash_id = parse_id(project_id), parse_id(dash_id)
    dash = await dash_repo.get_dashboard(project_id, dash_id)
    if not dash:
        raise HTTPException(status_code=404, detail="Dashboard not found in this project")

    charts = await dash_repo.charts_for_dashboard(dash_id)
    kpis: list[Any] = []
    tables: list[Any] = []
    visual_charts: list[Any] = []

    for c in charts:
        cfg = dict(c["config"] or {})
        stored_sql = cfg["sql"].strip() if isinstance(cfg.get("sql"), str) else None
        has_embedded = isinstance(cfg.get("data"), list) and len(cfg["data"]) > 0

        if stored_sql and not has_embedded:
            try:
                assert_select_only(stored_sql)
                assert_schema_scope(stored_sql, [warehouse_schema(project_id)])
                rows = await db.fetch_all(stored_sql)
                cfg["data"] = rows[:200]
            except (SqlValidationError, Exception) as sql_err:  # noqa: BLE001
                log.warning("live re-exec of chart SQL failed dash=%s title=%s", dash_id, c["title"])
                cfg["data"] = []
                cfg["sqlError"] = str(sql_err)

        if c["chart_type"] == "kpi":
            y_key = cfg.get("yKey")
            if isinstance(y_key, list):
                y_key = y_key[0] if y_key else None
            data = cfg.get("data") if isinstance(cfg.get("data"), list) else []
            first_row = data[0] if data else {}
            if y_key and y_key in first_row:
                value = first_row[y_key]
            else:
                first_key = next(iter(first_row), "")
                value = first_row.get(first_key) if first_row else None
            kpis.append({"label": c["title"], "value": value, "format": _kpi_format(c["title"]), "icon": _kpi_icon(c["title"])})
        elif c["chart_type"] == "table":
            tables.append({"title": c["title"], **cfg})
        else:
            question = cfg.get("question") if isinstance(cfg.get("question"), str) else None
            visual_charts.append(
                {
                    "title": c["title"],
                    "type": c["chart_type"],
                    "colSpan": c["col_span"] or 1,
                    "subtitle": question if question and question != c["title"] else None,
                    **cfg,
                }
            )

    # Auto-mode dashboards store their narrative report (markdown) in agent_log.
    agent_log = dash.get("agent_log")
    report = agent_log if isinstance(agent_log, str) and agent_log.lstrip().startswith("#") else None

    # Fetch flat-table rows + column metadata for the Advanced Analytics section.
    # The flat table is named proj_{project_id}_dash_{...} and created by the auto pipeline.
    ds_rows: list[Any] = []
    ds_cols: list[Any] = []
    flat_table = dash.get("flat_table_name")
    if flat_table:
        try:
            col_meta = await db.fetch_all(
                "SELECT column_name, data_type FROM information_schema.columns "
                "WHERE table_name = %s AND column_name != '_row_id' ORDER BY ordinal_position",
                [flat_table],
            )
            ds_cols = [
                {
                    "name": c["column_name"],
                    "type": (
                        "number" if re.search(r"int|float|numeric|double|real|decimal", c["data_type"], re.I)
                        else "boolean" if re.search(r"bool", c["data_type"], re.I)
                        else "string"
                    ),
                }
                for c in col_meta
            ]
            raw_rows = await db.fetch_all(f'SELECT * FROM "{flat_table}" LIMIT 1000')
            ds_rows = [{k: v for k, v in row.items() if k != "_row_id"} for row in raw_rows]
        except Exception:  # noqa: BLE001
            pass  # flat table missing or inaccessible — skip gracefully

    return {
        "id": dash["id"],
        "name": dash["name"],
        "createdAt": dash["created_at"].isoformat(),
        "report": report,
        "config": {
            "title": dash["name"],
            "kpis": kpis,
            "charts": visual_charts,
            "tables": tables,
            "dataScience": {"rows": ds_rows, "columns": ds_cols},
        },
    }


@router.delete("/projects/{project_id}/dashboards/{dash_id}", status_code=204)
async def delete_dashboard(project_id: int, dash_id: int):
    project_id, dash_id = parse_id(project_id), parse_id(dash_id)
    await dash_repo.delete_dashboard(project_id, dash_id)
    return Response(status_code=204)
