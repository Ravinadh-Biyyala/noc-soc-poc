"""Async client for the Grafana Loki HTTP API.

Wraps the handful of Loki read endpoints the dashboard needs (labels, label
values, query_range) and normalizes the responses into shapes the frontend can
render directly — log rows for `streams` results, and Recharts-friendly series
for `matrix`/`vector` metric results.

Loki timestamps are nanosecond epoch strings; we expose milliseconds (JS-native)
on the normalized output and keep the raw ns where useful.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from functools import lru_cache
from typing import Any

import httpx

from ..config import get_settings

log = logging.getLogger("agents.loki.client")

# Accepts e.g. "15m", "1h", "6h", "24h", "7d", "30s". Used to resolve a relative
# lookback window into an absolute [start, end] range.
_DURATION_RE = re.compile(r"^\s*(\d+)\s*(s|m|h|d|w|y)\s*$", re.IGNORECASE)
_UNIT_SECONDS = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800, "y": 31536000}


def duration_to_seconds(value: str, default: int = 3600) -> int:
    """Parse a Loki-style duration like '1h' / '24h' / '7d' into seconds."""
    if not value:
        return default
    m = _DURATION_RE.match(str(value))
    if not m:
        return default
    return int(m.group(1)) * _UNIT_SECONDS[m.group(2).lower()]


def _ns_to_ms(ns: str | int) -> int:
    try:
        return int(int(ns) // 1_000_000)
    except (TypeError, ValueError):
        return 0


def _try_parse_json(line: str) -> dict | None:
    line = (line or "").strip()
    if not (line.startswith("{") and line.endswith("}")):
        return None
    try:
        parsed = json.loads(line)
        return parsed if isinstance(parsed, dict) else None
    except (ValueError, TypeError):
        return None


class LokiClient:
    """Thin async wrapper over Loki's `/loki/api/v1/*` read endpoints."""

    def __init__(self, base_url: str, timeout: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    # Transient transport faults (no HTTP response received). Under the dashboard's
    # ~15-way parallel fan-out, this Loki instance intermittently drops the heaviest
    # connection ("Server disconnected without sending a response") — retrying the
    # same query then succeeds. We only retry these; HTTP 4xx/5xx are real errors.
    _TRANSIENT = (httpx.RemoteProtocolError, httpx.ConnectError, httpx.ReadError,
                  httpx.WriteError, httpx.ConnectTimeout, httpx.ReadTimeout, httpx.PoolTimeout)
    _RETRIES = 3

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> dict:
        url = f"{self.base_url}{path}"
        for attempt in range(self._RETRIES):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    resp = await client.get(url, params=params)
                    resp.raise_for_status()
                    return resp.json()
            except self._TRANSIENT as err:
                if attempt == self._RETRIES - 1:
                    raise
                log.warning("Loki transient error on %s (attempt %d/%d): %s — retrying",
                            path, attempt + 1, self._RETRIES, err)
                await asyncio.sleep(0.4 * (attempt + 1))
        raise RuntimeError("unreachable")  # loop either returns or raises

    async def ready(self) -> bool:
        url = f"{self.base_url}/ready"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(url)
            return resp.status_code == 200

    @staticmethod
    def _range_params(start_ns: int | None, end_ns: int | None) -> dict[str, str]:
        # Loki's /labels and /label/.../values are time-bounded; without an
        # explicit range they only return values seen in a short default window,
        # so a label value that hasn't logged recently silently disappears.
        params: dict[str, str] = {}
        if start_ns is not None:
            params["start"] = str(start_ns)
        if end_ns is not None:
            params["end"] = str(end_ns)
        return params

    async def labels(self, *, start_ns: int | None = None, end_ns: int | None = None) -> list[str]:
        body = await self._get("/loki/api/v1/labels", self._range_params(start_ns, end_ns) or None)
        return list(body.get("data") or [])

    async def label_values(self, name: str, *, start_ns: int | None = None, end_ns: int | None = None) -> list[str]:
        body = await self._get(f"/loki/api/v1/label/{name}/values", self._range_params(start_ns, end_ns) or None)
        return list(body.get("data") or [])

    async def query_range(
        self,
        logql: str,
        *,
        start_ns: int,
        end_ns: int,
        limit: int = 200,
        step: str | None = None,
        direction: str = "backward",
    ) -> dict:
        """Run a range query and return the raw Loki payload."""
        params: dict[str, Any] = {
            "query": logql,
            "start": str(start_ns),
            "end": str(end_ns),
            "limit": str(limit),
            "direction": direction,
        }
        if step:
            params["step"] = step
        return await self._get("/loki/api/v1/query_range", params)

    async def query_instant(self, logql: str, *, time_ns: int | None = None) -> dict:
        """Run an instant query (single evaluation) — used for `topk`/`count`
        snapshots like current top-N devices or device-per-category inventory."""
        params: dict[str, Any] = {"query": logql}
        if time_ns is not None:
            params["time"] = str(time_ns)
        return await self._get("/loki/api/v1/query", params)

    # ── Normalization ────────────────────────────────────────────────────────
    @staticmethod
    def normalize(body: dict) -> dict:
        """Translate a Loki query response into a frontend-friendly shape.

        - `streams`  -> {"kind": "logs",   "rows": [...],   "stats": {...}}
        - `matrix`   -> {"kind": "metric", "series": [...], "stats": {...}}
        - `vector`   -> {"kind": "metric", "series": [...], "stats": {...}}
        """
        data = body.get("data") or {}
        result_type = data.get("resultType")
        result = data.get("result") or []
        stats = LokiClient._summarize_stats(data.get("stats") or {})

        if result_type == "streams":
            rows: list[dict] = []
            for stream in result:
                labels = stream.get("stream") or {}
                for ts_ns, line in stream.get("values") or []:
                    parsed = _try_parse_json(line)
                    rows.append(
                        {
                            "ts": _ns_to_ms(ts_ns),
                            "tsNs": str(ts_ns),
                            "labels": labels,
                            "severity": labels.get("severity"),
                            "service": labels.get("service_name") or labels.get("app"),
                            "line": line,
                            "message": (parsed or {}).get("message"),
                            "parsed": parsed,
                        }
                    )
            rows.sort(key=lambda r: r["ts"], reverse=True)
            return {"kind": "logs", "rows": rows, "rowCount": len(rows), "stats": stats}

        if result_type in ("matrix", "vector"):
            series: list[dict] = []
            for entry in result:
                metric = entry.get("metric") or {}
                name = (
                    metric.get("severity")
                    or metric.get("service_name")
                    or metric.get("level")
                    or metric.get("__name__")
                )
                if not name:
                    # `sum by (x)` yields a single-label metric — use its value as
                    # the series name (e.g. {ip:"1.2.3.4"} -> "1.2.3.4").
                    if len(metric) == 1:
                        name = next(iter(metric.values()))
                    else:
                        name = LokiClient._label_signature(metric) or "value"
                if result_type == "matrix":
                    values = [
                        {"ts": _ns_to_ms(int(float(t)) * 1_000_000_000), "value": float(v)}
                        for t, v in (entry.get("values") or [])
                    ]
                else:  # vector — single sample
                    t, v = entry.get("value") or [0, "0"]
                    values = [{"ts": _ns_to_ms(int(float(t)) * 1_000_000_000), "value": float(v)}]
                series.append({"name": name, "metric": metric, "values": values})
            return {"kind": "metric", "series": series, "stats": stats}

        return {"kind": "unknown", "raw": result, "stats": stats}

    @staticmethod
    def _label_signature(metric: dict) -> str:
        return ", ".join(f"{k}={v}" for k, v in sorted(metric.items())) if metric else ""

    @staticmethod
    def _summarize_stats(stats: dict) -> dict:
        summary = (stats or {}).get("summary") or {}
        return {
            "totalLinesProcessed": summary.get("totalLinesProcessed"),
            "totalEntriesReturned": summary.get("totalEntriesReturned"),
            "execTime": summary.get("execTime"),
            "bytesProcessedPerSecond": summary.get("bytesProcessedPerSecond"),
        }


@lru_cache(maxsize=1)
def get_loki_client() -> LokiClient:
    s = get_settings()
    return LokiClient(base_url=s.loki_url, timeout=float(s.loki_timeout))


def now_ns() -> int:
    return int(time.time() * 1_000_000_000)
