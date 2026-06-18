"""Loki logs routes — read-only proxy + query endpoints for the Grafana Loki
server. Not project-scoped: Loki is a single shared external server.

Exposed under /api/loki (Express forwards /api/loki/* here when AGENTS_SERVICE_URL
is set). Powers the "Loki Logs" dashboard tab: dropdown filters read labels/values,
and the CopilotKit agent's `queryLoki` action posts dynamically-generated LogQL.
"""
from __future__ import annotations

import asyncio
import logging

import httpx
from fastapi import APIRouter, Body, HTTPException

from ..config import get_settings
from ..loki.client import duration_to_seconds, get_loki_client, now_ns
from ..loki.noc import function_specs, run_function

log = logging.getLogger("agents.routes.loki")
router = APIRouter()

_MAX_LIMIT = 5000


def _loki_error(err: Exception) -> HTTPException:
    if isinstance(err, httpx.HTTPStatusError):
        detail = f"Loki returned {err.response.status_code}: {err.response.text[:300]}"
        return HTTPException(status_code=502, detail=detail)
    if isinstance(err, httpx.RequestError):
        return HTTPException(status_code=502, detail=f"Cannot reach Loki server: {err}")
    return HTTPException(status_code=500, detail=str(err))


def _label_window(since: str | None) -> tuple[int, int]:
    """Resolve the lookback window for label discovery into a [start, end] ns
    range. Defaults to the configured wide window so every value is surfaced."""
    window = since or get_settings().loki_label_window
    window_s = duration_to_seconds(window, default=30 * 86400)
    end_ns = now_ns()
    return end_ns - window_s * 1_000_000_000, end_ns


@router.get("/loki/ready")
async def loki_ready():
    client = get_loki_client()
    try:
        ok = await client.ready()
        return {"ready": ok, "url": client.base_url}
    except Exception as err:  # noqa: BLE001
        return {"ready": False, "url": client.base_url, "error": str(err)}


@router.get("/loki/labels")
async def loki_labels(since: str | None = None):
    client = get_loki_client()
    start_ns, end_ns = _label_window(since)
    try:
        return {"labels": await client.labels(start_ns=start_ns, end_ns=end_ns)}
    except Exception as err:  # noqa: BLE001
        raise _loki_error(err)


@router.get("/loki/labels-with-values")
async def loki_labels_with_values(since: str | None = None):
    """All label names mapped to their values — powers the Grafana-style label
    filter builder (one fetch instead of N) and grounds the Copilot agent.

    Discovery uses a wide lookback (config `loki_label_window`, default 30d) so
    every value is surfaced even if it hasn't logged in the query time-range."""
    client = get_loki_client()
    start_ns, end_ns = _label_window(since)
    try:
        labels = await client.labels(start_ns=start_ns, end_ns=end_ns)

        async def fetch(label: str) -> tuple[str, list[str]]:
            try:
                return label, await client.label_values(label, start_ns=start_ns, end_ns=end_ns)
            except Exception:  # noqa: BLE001 — skip a label that fails, keep the rest
                return label, []

        pairs = await asyncio.gather(*[fetch(lbl) for lbl in labels])
        return {"labels": {lbl: vals for lbl, vals in pairs}}
    except Exception as err:  # noqa: BLE001
        raise _loki_error(err)


@router.get("/loki/label/{name}/values")
async def loki_label_values(name: str, since: str | None = None):
    client = get_loki_client()
    start_ns, end_ns = _label_window(since)
    try:
        return {"label": name, "values": await client.label_values(name, start_ns=start_ns, end_ns=end_ns)}
    except Exception as err:  # noqa: BLE001
        raise _loki_error(err)


@router.get("/loki/noc/functions")
async def loki_noc_functions():
    """List the canonical NOC query-function specs (name, description, params).

    Consumed by the frontend to register CopilotKit tools and by the agent so it
    calls a named function instead of hallucinating LogQL."""
    return {"functions": function_specs()}


@router.post("/loki/noc/{name}")
async def loki_noc_run(name: str, body: dict = Body(default={})):
    """Run a canonical NOC function by name with JSON params → structured result."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="JSON body required")
    client = get_loki_client()
    try:
        return await run_function(client, name, body)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown NOC function '{name}'")
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except Exception as err:  # noqa: BLE001
        log.exception("noc function failed: %s", name)
        raise _loki_error(err)


@router.post("/loki/query")
async def loki_query(body: dict = Body(default={})):
    """Run a LogQL query.

    Body: {
      logql: str (required),
      kind: "logs" | "metric" (default "logs"),
      since: str (relative lookback, e.g. "1h"; default "1h"),
      start, end: optional ns epoch ints (override `since`),
      limit: int (logs only, default 200),
      step: str (metric only, e.g. "5m"; default derived from range),
    }
    """
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="JSON body required")

    logql = (body.get("logql") or "").strip()
    if not logql:
        raise HTTPException(status_code=400, detail="logql is required")

    kind = body.get("kind") or "logs"
    since = body.get("since") or "1h"
    window_s = duration_to_seconds(since, default=3600)

    end_ns = int(body["end"]) if body.get("end") else now_ns()
    start_ns = int(body["start"]) if body.get("start") else end_ns - window_s * 1_000_000_000

    limit = min(int(body.get("limit") or 200), _MAX_LIMIT)

    # For metric queries Loki requires a step; default to ~120 buckets across the window.
    step = body.get("step")
    if kind == "metric" and not step:
        bucket_s = max(window_s // 120, 15)
        step = f"{bucket_s}s"

    client = get_loki_client()
    try:
        raw = await client.query_range(
            logql,
            start_ns=start_ns,
            end_ns=end_ns,
            limit=limit,
            step=step if kind == "metric" else None,
        )
        normalized = client.normalize(raw)
        normalized["query"] = {
            "logql": logql,
            "kind": kind,
            "since": since,
            "startNs": str(start_ns),
            "endNs": str(end_ns),
            "step": step,
        }
        return normalized
    except Exception as err:  # noqa: BLE001
        log.exception("loki query failed: %s", logql)
        raise _loki_error(err)
