"""Canonical NOC/SOC query-function registry.

A single source of truth for every metric the NOC dashboard shows and the BI
Companion chat can call. Each function encapsulates a *validated* LogQL query and
returns structured JSON — so the frontend never re-derives queries and the chat
agent calls a named function instead of hallucinating LogQL (it only falls back
to raw LogQL via the generic `queryLoki` action for novel questions).

Data model (Grafana Loki, JSON-structured lines):
  • Device metrics  — {metric="cpu_utilization_percent|interface_utilization_percent|
                       latency_ms", device_id}, line {"value": N}
  • Monitoring alarms — {source="solarwinds|manageengine", category, device_id,
                       model, severity}, line {"alert_id","status","message"}
  • AI diagnosis     — {source="ai-agent", agent="incident|rca|recommendation|
                       anomaly|summary", incident_type, severity}, rich JSON keyed
                       by incident_id
  • Legacy syslog    — {job="system", filename=...} (SSH brute-force → Security)

Everything is exposed via two routes (see routes/loki.py):
  GET  /api/loki/noc/functions   → the specs below (for the agent + frontend)
  POST /api/loki/noc/{name}      → run a function with JSON params
"""
from __future__ import annotations

import logging
import os
from typing import Any, Awaitable, Callable

from .client import LokiClient, duration_to_seconds, now_ns

log = logging.getLogger("agents.loki.noc")

# Stream selector matching the two real monitoring sources (alarms/alerts).
ALARM_SOURCES = 'source=~"solarwinds|manageengine"'
METRICS = ("cpu_utilization_percent", "interface_utilization_percent", "latency_ms")
_AGG_FN = {"avg": "avg_over_time", "max": "max_over_time", "min": "min_over_time", "sum": "sum_over_time"}

# This Loki enforces max_query_length = 30d1h. It applies to the start..end window
# of range/log queries AND to `unwrap` metric range-vectors — but NOT to plain
# `count_over_time`/`label_format` range-vectors on an INSTANT query, which we can
# safely run at up to a year. So: count-based aggregates honour the full lookback
# (e.g. "1y"), while anything that fetches log lines or unwraps a metric is clamped
# to 30 days. Without this clamp, picking "Last 1 year" 400s the whole dashboard.
SCAN_MAX_DAYS = 30

# The new feeds emit severity in mixed case (solarwinds/sentinel UPPER,
# manageengine/ai-agent lower/Title). Three reliable ways to cope, used per query:
#  • aggregations  → count by raw severity, then merge lower-cased in Python
#    (`_merge_sev`) — plain count_over_time is reliable even at a 1y range.
#  • trend (≤30d)  → `label_format` into a FRESH `_sev` label so Loki merges
#    server-side (reusing `severity` silently breaks LOG queries on this server).
#  • log filters   → a case-insensitive regex on the severity label in the SELECTOR
#    (`severity=~"(?i)critical"`), which needs no pipeline (`_sev_matcher`).
_TREND_LOWER_SEV = "| label_format _sev=`{{ lower .severity }}`"

# ── small helpers ──────────────────────────────────────────────────────────


def _clamp_secs(since: str | None, max_days: int = SCAN_MAX_DAYS, default_s: int = 86400) -> int:
    return min(duration_to_seconds(since or "24h", default=default_s), max_days * 86400)


def _window(since: str | None, default_s: int = 86400) -> tuple[int, int]:
    end_ns = now_ns()
    return end_ns - duration_to_seconds(since or "24h", default=default_s) * 1_000_000_000, end_ns


def _window_scan(since: str | None) -> tuple[int, int]:
    """Absolute [start, end] clamped to the 30d server limit — for log/range queries."""
    end_ns = now_ns()
    return end_ns - _clamp_secs(since) * 1_000_000_000, end_ns


def _range(since: str | None) -> str:
    """A LogQL range string ('[24h]') from a relative lookback. For count_over_time
    aggregates only — these may span the full lookback (up to a year)."""
    return f"[{(since or '24h').strip()}]"


def _range_scan(since: str | None) -> str:
    """A range string clamped to the 30d server limit — for `unwrap` metric queries."""
    return f"[{_clamp_secs(since)}s]"


def _norm_sev(s: Any) -> str:
    return str(s or "").strip().lower()


def _merge_sev(pairs: list[tuple[str, float]]) -> list[dict]:
    """Lower-case + merge severity (name, value) pairs into deduped counts, desc."""
    tally: dict[str, int] = {}
    for name, val in pairs:
        if not name or name == "value":
            continue
        k = _norm_sev(name)
        tally[k] = tally.get(k, 0) + int(val)
    return [{"severity": k, "count": v} for k, v in sorted(tally.items(), key=lambda x: -x[1])]


def _sev_matcher(severity: str | None) -> str | None:
    """A case-insensitive severity matcher for a stream SELECTOR (reliable for log
    queries, where reusing the `severity` label in `label_format` misbehaves)."""
    sev = _norm_sev(severity)
    return f'severity=~"(?i){_esc(sev)}"' if sev else None


def _esc(value: str) -> str:
    """Escape a value for use inside a LogQL `label="value"` matcher."""
    return str(value).replace("\\", "\\\\").replace('"', '\\"')


def _vector_pairs(normalized: dict) -> list[tuple[str, float]]:
    """(name, value) pairs from a normalized instant/vector result, sorted desc."""
    out: list[tuple[str, float]] = []
    for s in normalized.get("series") or []:
        vals = s.get("values") or []
        out.append((str(s.get("name")), float(vals[-1]["value"]) if vals else 0.0))
    out.sort(key=lambda p: p[1], reverse=True)
    return out


async def _instant(client: LokiClient, logql: str) -> dict:
    return client.normalize(await client.query_instant(logql))


async def _instant_raw(client: LokiClient, logql: str) -> list[dict]:
    """Raw instant-query result entries ({metric: {...labels}, value: [ts, str]}),
    for `sum by (a, b, …)` queries where we need the FULL label set per series
    (normalize() keeps only one name)."""
    body = await client.query_instant(logql)
    return (body.get("data") or {}).get("result") or []


async def _logs(client: LokiClient, logql: str, since: str | None, limit: int) -> list[dict]:
    # Fetching log lines is always clamped to the 30d server scan limit.
    start_ns, end_ns = _window_scan(since)
    raw = await client.query_range(logql, start_ns=start_ns, end_ns=end_ns, limit=limit, direction="backward")
    return client.normalize(raw).get("rows") or []


def _alarm_row(row: dict) -> dict:
    """Flatten a normalized alarm log row + its parsed JSON into a tidy record.

    The two alarm feeds disagree on the device label — manageengine tags
    `device_id` (e.g. FW-SLU-VFT-01) while solarwinds tags `node`
    (e.g. DC-Router-03) — so fall back across both. Severity is lower-cased to a
    single scheme (feeds emit INFO/Info/info)."""
    p = row.get("parsed") or {}
    labels = row.get("labels") or {}
    return {
        "ts": row.get("ts"),
        "time": row.get("ts"),
        "alert_id": p.get("alert_id"),
        "device_id": labels.get("device_id") or labels.get("node"),
        "model": labels.get("model"),
        "category": labels.get("category"),
        "severity": _norm_sev(labels.get("severity")),
        "source": labels.get("source"),
        "status": p.get("status"),
        "message": p.get("message") or row.get("line"),
    }


# ── function implementations ───────────────────────────────────────────────


# Devices/streams can lack a `category` label; `count by (category)` then yields an
# empty-label group the normalizer names "value". Drop it so it never shows as a
# bogus "Value" category.
def _real_categories(norm: dict) -> list[dict]:
    return [{"category": name, "count": int(val)} for name, val in _vector_pairs(norm) if name and name != "value"]


async def _device_inventory(client: LokiClient, p: dict) -> dict:
    since = p.get("since") or "24h"
    norm = await _instant(client, f"count by (category) (sum by (category, device_id) (count_over_time({{{ALARM_SOURCES}}}{_range(since)})))")
    cats = _real_categories(norm)
    return {"function": "device_inventory", "since": since, "categories": cats, "total": sum(c["count"] for c in cats)}


async def _events_by_category(client: LokiClient, p: dict) -> dict:
    since = p.get("since") or "24h"
    norm = await _instant(client, f"sum by (category) (count_over_time({{{ALARM_SOURCES}}}{_range(since)}))")
    cats = _real_categories(norm)
    return {"function": "events_by_category", "since": since, "categories": cats, "total": sum(c["count"] for c in cats)}


def _alarm_stream(p: dict, severity: str | None = None) -> str:
    """Stream selector for alarms. Severity (if given) is matched case-insensitively
    in the selector itself, which is the reliable path for log-line queries."""
    matchers = [ALARM_SOURCES]
    sev = _sev_matcher(severity)
    if sev:
        matchers.append(sev)
    if p.get("category"):
        matchers.append(f'category="{_esc(p["category"])}"')
    if p.get("device_id"):
        matchers.append(f'device_id="{_esc(p["device_id"])}"')
    return "{" + ", ".join(matchers) + "}"


async def _alarms_by_severity(client: LokiClient, p: dict) -> dict:
    since = p.get("since") or "24h"
    sel = _alarm_stream(p)  # no severity filter — we want the full breakdown
    # Plain count_over_time is reliable at a 1y range; merge mixed-case in Python.
    norm = await _instant(client, f"sum by (severity) (count_over_time({sel}{_range(since)}))")
    sev = _merge_sev(_vector_pairs(norm))
    return {"function": "alarms_by_severity", "since": since, "severities": sev, "total": sum(s["count"] for s in sev)}


async def _alarm_trend(client: LokiClient, p: dict) -> dict:
    since = p.get("since") or "24h"
    # The trend is a range query (start..end) so it's clamped to the 30d limit. Use a
    # fresh `_sev` label so Loki merges INFO/Info/info into one series server-side.
    window_s = _clamp_secs(since)
    step = f"{max(window_s // 120, 60)}s"
    start_ns, end_ns = _window_scan(since)
    sel = _alarm_stream(p)
    raw = await client.query_range(f"sum by (_sev) (count_over_time({sel} {_TREND_LOWER_SEV} [{step}]))",
                                   start_ns=start_ns, end_ns=end_ns, step=step, limit=500)
    norm = client.normalize(raw)
    return {"function": "alarm_trend", "since": since, "series": norm.get("series") or []}


async def _top_alarms(client: LokiClient, p: dict) -> dict:
    since = p.get("since") or "24h"
    severity = p.get("severity") or "critical"
    sel = _alarm_stream(p, severity)
    limit = int(p.get("limit") or 15)
    rows = await _logs(client, sel, since, max(limit * 3, 60))
    alarms = [_alarm_row(r) for r in rows][:limit]
    return {"function": "top_alarms", "since": since, "severity": _norm_sev(severity), "count": len(alarms), "alarms": alarms}


def _incident_row(row: dict) -> dict:
    p = row.get("parsed") or {}
    labels = row.get("labels") or {}
    # The incident JSON carries type/severity in UPPER/Title case (NETWORK, Warning)
    # while the labels are lower-case — normalize to lower so the UI/tabs match.
    return {
        "ts": row.get("ts"),
        "incident_id": p.get("incident_id"),
        "type": _norm_sev(labels.get("incident_type") or p.get("type")),
        "severity": _norm_sev(labels.get("severity") or p.get("severity")),
        "incident": p.get("incident") or p.get("summary"),
        "summary": p.get("summary"),
        "source": p.get("source"),
        "root_cause": p.get("root_cause"),
        "confidence": p.get("confidence"),
        "affected_assets": p.get("affected_assets") or [],
        "early_warning": p.get("early_warning"),
    }


async def _incidents(client: LokiClient, p: dict) -> dict:
    since = p.get("since") or "24h"
    matchers = ['agent="incident"']
    if p.get("severity"):
        matchers.append(f'severity="{_esc(_norm_sev(p["severity"]))}"')
    if p.get("incident_type"):
        matchers.append(f'incident_type="{_esc(_norm_sev(p["incident_type"]))}"')
    sel = "{" + ", ".join(matchers) + "}"
    limit = int(p.get("limit") or 20)
    rows = await _logs(client, sel, since, max(limit * 2, 50))
    incidents = [_incident_row(r) for r in rows]
    # De-dupe by incident_id, newest first (rows already newest→oldest).
    seen, deduped = set(), []
    for inc in incidents:
        iid = inc.get("incident_id")
        if iid and iid in seen:
            continue
        seen.add(iid)
        deduped.append(inc)
    deduped = deduped[:limit]
    # Severity tally for the Incident Summary donut.
    tally: dict[str, int] = {}
    for inc in deduped:
        sv = str(inc.get("severity") or "unknown").lower()
        tally[sv] = tally.get(sv, 0) + 1
    return {"function": "incidents", "since": since, "count": len(deduped), "incidents": deduped,
            "by_severity": [{"severity": k, "count": v} for k, v in sorted(tally.items(), key=lambda x: -x[1])]}


async def _incident_detail(client: LokiClient, p: dict) -> dict:
    incident_id = (p.get("incident_id") or "").strip()
    if not incident_id:
        raise ValueError("incident_id is required")
    rows = await _logs(client, f'{{source="ai-agent"}} |= "{_esc(incident_id)}"', p.get("since") or "30d", 50)
    detail: dict[str, Any] = {"incident_id": incident_id, "raw_logs": []}
    by_agent: dict[str, dict] = {}
    for r in rows:
        parsed = r.get("parsed") or {}
        agent = (r.get("labels") or {}).get("agent") or "?"
        by_agent.setdefault(agent, parsed)
        detail["raw_logs"].append({"agent": agent, "ts": r.get("ts"), "line": r.get("line")})

    inc = by_agent.get("incident", {})
    rca = by_agent.get("rca", {})
    rec = by_agent.get("recommendation", {})
    summ = by_agent.get("summary", {})
    anom = by_agent.get("anomaly", {})
    detail.update({
        "incident": inc.get("incident") or summ.get("incident"),
        "summary": inc.get("summary") or summ.get("summary"),
        "severity": inc.get("severity") or summ.get("severity") or rec.get("severity"),
        "type": inc.get("type") or summ.get("type"),
        "source": inc.get("source"),
        "affected_assets": inc.get("affected_assets") or rca.get("affected_assets") or [],
        "root_cause": rca.get("root_cause") or inc.get("root_cause"),
        "rca_summary": rca.get("rca_summary"),
        "confidence": rca.get("confidence") or inc.get("confidence"),
        "evidence": rca.get("evidence") or [],
        "recommendation": rec.get("recommendation") or inc.get("recommendation") or [],
        "escalation_team": rec.get("escalation_team"),
        "automatable": rec.get("automatable"),
        "early_warning": anom or ({"early_warning": inc.get("early_warning")} if inc else None),
    })
    detail["function"] = "incident_detail"
    return detail


async def _device_events_window(client: LokiClient, device_id: str, before_ms: int, window_s: int, limit: int = 40) -> list[dict]:
    """The device's most-recent monitoring-alarm burst at/before an incident,
    returned oldest→newest — the precursor events a trace correlates. (Incidents
    are emitted in real time but the alarm data can be hours older, so we take the
    newest events within a wide lookback rather than a window centred on the
    incident timestamp.)"""
    end_ns = (before_ms + 300_000) * 1_000_000  # tiny look-ahead past the incident
    start_ns = end_ns - window_s * 1_000_000_000
    raw = await client.query_range(f'{{{ALARM_SOURCES}, device_id="{_esc(device_id)}"}}',
                                   start_ns=start_ns, end_ns=end_ns, limit=limit, direction="backward")
    rows = client.normalize(raw).get("rows") or []
    rows.sort(key=lambda r: r.get("ts") or 0)
    return rows


async def _recent_incident_traces(client: LokiClient, p: dict) -> dict:
    """Light list of traceable major incidents (critical+high by default) for the
    real-time Traces feed + tab badges. No span computation — kept cheap for polling."""
    since = p.get("since") or "24h"
    limit = int(p.get("limit") or 30)
    sev_filter = (p.get("severity") or "").lower() or None
    matchers = ['agent="incident"']
    if p.get("incident_type"):
        matchers.append(f'incident_type="{_esc(p["incident_type"])}"')
    rows = await _logs(client, "{" + ", ".join(matchers) + "}", since, max(limit * 3, 90))
    major = {"critical", "high"}
    seen: set[str] = set()
    items: list[dict] = []
    tally: dict[str, int] = {}
    for r in rows:
        inc = _incident_row(r)
        iid = inc.get("incident_id")
        if not iid or iid in seen:
            continue
        sev = str(inc.get("severity") or "").lower()
        if sev_filter:
            if sev != sev_filter:
                continue
        elif sev not in major:
            continue
        seen.add(iid)
        typ = str(inc.get("type") or "unknown").lower()
        tally[typ] = tally.get(typ, 0) + 1
        items.append({
            "incident_id": iid,
            "type": inc.get("type"),
            "severity": inc.get("severity"),
            "device_id": (inc.get("affected_assets") or [None])[0],
            "title": inc.get("incident") or inc.get("summary"),
            "ts": inc.get("ts"),
        })
    return {
        "function": "recent_incident_traces", "since": since, "count": len(items[:limit]),
        "incidents": items[:limit],
        "by_type": [{"type": k, "count": v} for k, v in sorted(tally.items(), key=lambda x: -x[1])],
    }


async def _incident_trace(client: LokiClient, p: dict) -> dict:
    """Reconstruct ONE incident's waterfall: the affected device's correlated
    precursor events (real, spread-out timestamps) → the AI diagnosis phases
    (detection → root cause → recommendation), as ordered spans with offsets."""
    incident_id = (p.get("incident_id") or "").strip()
    if not incident_id:
        raise ValueError("incident_id is required")
    window_s = duration_to_seconds(p.get("window") or "24h", default=86400)
    detail = await _incident_detail(client, {"incident_id": incident_id, "since": "30d"})
    device_id = (detail.get("affected_assets") or [None])[0]

    inc_ts = None
    for r in detail.get("raw_logs") or []:
        if r.get("agent") == "incident":
            inc_ts = r.get("ts")
            break
    if inc_ts is None:
        ts_list = [r.get("ts") for r in (detail.get("raw_logs") or []) if r.get("ts")]
        inc_ts = max(ts_list) if ts_list else now_ns() // 1_000_000

    events: list[dict] = []
    if device_id:
        for r in await _device_events_window(client, device_id, inc_ts, window_s):
            if not r.get("ts"):
                continue
            pj = r.get("parsed") or {}
            events.append({
                "ts": r["ts"], "severity": (r.get("labels") or {}).get("severity"),
                "source": (r.get("labels") or {}).get("source"),
                "message": pj.get("message") or r.get("line"),
            })
    events.sort(key=lambda e: e["ts"])

    # The diagnosis phases logically follow the precursor events. Anchor them at the
    # end of the event sequence (NOT the real incident ts, which can be hours later
    # due to batch processing) so the waterfall stays event-focused and readable.
    start = events[0]["ts"] if events else inc_ts
    anchor = events[-1]["ts"] if events else inc_ts
    diag_off = anchor - start
    floor = max(int((diag_off or 1) * 0.012), 1000)
    cap = max(diag_off // 4, floor)
    diag_dur = max(int((diag_off or 1) * 0.06), floor)
    total = max(diag_off + diag_dur, 1)

    spans: list[dict] = []
    for i, e in enumerate(events):
        nxt = events[i + 1]["ts"] if i + 1 < len(events) else anchor
        dur = max(min(nxt - e["ts"], cap), floor)
        spans.append({"label": (e["message"] or "event")[:80], "kind": "event",
                      "severity": e["severity"], "source": e["source"], "message": e["message"],
                      "ts": e["ts"], "offset_ms": e["ts"] - start, "duration_ms": dur})

    ew = detail.get("early_warning") if isinstance(detail.get("early_warning"), dict) else {}
    diag: list[tuple[str, str, str | None]] = []
    if ew and (ew.get("warning") or ew.get("kind")):
        diag.append(("warning", "Early warning", ew.get("warning") or ew.get("kind")))
    diag += [
        ("diagnosis", "Incident detected", detail.get("incident") or detail.get("summary")),
        ("diagnosis", "Root cause analysis", detail.get("root_cause")),
        ("diagnosis", "Recommendation", " | ".join(detail.get("recommendation") or []) or None),
    ]
    for kind, label, msg in diag:
        if msg:
            spans.append({"label": label, "kind": kind, "severity": detail.get("severity"),
                          "source": "ai-agent", "message": msg, "ts": anchor,
                          "offset_ms": diag_off, "duration_ms": diag_dur})

    return {
        "function": "incident_trace", "incident_id": incident_id, "device_id": device_id,
        "incident": detail.get("incident") or detail.get("summary"),
        "severity": detail.get("severity"), "type": detail.get("type"),
        "root_cause": detail.get("root_cause"), "rca_summary": detail.get("rca_summary"),
        "confidence": detail.get("confidence"), "recommendation": detail.get("recommendation") or [],
        "escalation_team": detail.get("escalation_team"), "evidence": detail.get("evidence") or [],
        "detected_at": inc_ts, "started_at": start, "ended_at": anchor, "duration_ms": total,
        "span_count": len(spans), "spans": spans, "summary": detail.get("summary"),
    }


async def _early_warnings(client: LokiClient, p: dict) -> dict:
    since = p.get("since") or "24h"
    limit = int(p.get("limit") or 15)
    rows = await _logs(client, '{agent="anomaly"}', since, max(limit * 2, 40))
    warnings = []
    for r in rows:
        parsed = r.get("parsed") or {}
        warnings.append({
            "ts": r.get("ts"),
            "incident_id": parsed.get("incident_id"),
            "kind": parsed.get("kind"),
            "risk": parsed.get("risk"),
            "warning": parsed.get("warning"),
            "asset": parsed.get("asset"),
            "observed": parsed.get("observed"),
            "threshold": parsed.get("threshold"),
        })
    return {"function": "early_warnings", "since": since, "count": len(warnings[:limit]), "warnings": warnings[:limit]}


def _validate_metric(metric: str | None) -> str:
    m = (metric or "cpu_utilization_percent").strip()
    if m not in METRICS:
        raise ValueError(f"metric must be one of {METRICS}")
    return m


async def _top_devices_by_metric(client: LokiClient, p: dict) -> dict:
    metric = _validate_metric(p.get("metric"))
    since = p.get("since") or "24h"
    agg = p.get("agg") if p.get("agg") in _AGG_FN else "avg"
    over = _AGG_FN[agg]
    limit = int(p.get("limit") or 10)
    # `unwrap` is subject to the 30d scan limit, so the range selector is clamped.
    logql = f'topk({limit}, {agg} by (device_id) ({over}({{metric="{metric}"}} | json | unwrap value {_range_scan(since)})))'
    norm = await _instant(client, logql)
    devices = [{"device_id": name, "value": round(val, 2)} for name, val in _vector_pairs(norm)]
    return {"function": "top_devices_by_metric", "metric": metric, "agg": agg, "since": since, "devices": devices}


async def _metric_trend(client: LokiClient, p: dict) -> dict:
    metric = _validate_metric(p.get("metric"))
    since = p.get("since") or "24h"
    agg = p.get("agg") if p.get("agg") in _AGG_FN else "avg"
    over = _AGG_FN[agg]
    # Trend is a range query over `unwrap` — clamp the window to the 30d limit.
    start_ns, end_ns = _window_scan(since)
    window_s = _clamp_secs(since)
    step_s = max(window_s // 120, 60)
    step = f"{step_s}s"
    device_id = (p.get("device_id") or "").strip()
    if device_id:
        logql = f'{over}({{metric="{metric}", device_id="{_esc(device_id)}"}} | json | unwrap value [{step}])'
    else:
        logql = f'avg({over}({{metric="{metric}"}} | json | unwrap value [{step}]))'
    raw = await client.query_range(logql, start_ns=start_ns, end_ns=end_ns, step=step, limit=10)
    norm = client.normalize(raw)
    return {"function": "metric_trend", "metric": metric, "agg": agg, "since": since,
            "device_id": device_id or None, "series": norm.get("series") or []}


async def _device_health(client: LokiClient, p: dict) -> dict:
    device_id = (p.get("device_id") or "").strip()
    if not device_id:
        raise ValueError("device_id is required")
    since = p.get("since") or "24h"
    rng = _range(since)
    scan_rng = _range_scan(since)  # `unwrap` queries are 30d-capped
    # Latest value per metric via last_over_time.
    latest: dict[str, float | None] = {}
    for m in METRICS:
        norm = await _instant(client, f'last_over_time({{metric="{m}", device_id="{_esc(device_id)}"}} | json | unwrap value {scan_rng})')
        pairs = _vector_pairs(norm)
        latest[m] = round(pairs[0][1], 2) if pairs else None
    # Open alarm count + recent alarms for this device.
    open_norm = await _instant(client, f'sum(count_over_time({{{ALARM_SOURCES}, device_id="{_esc(device_id)}"}}{rng}))')
    open_pairs = _vector_pairs(open_norm)
    open_alarms = int(open_pairs[0][1]) if open_pairs else 0
    alarm_rows = await _logs(client, f'{{{ALARM_SOURCES}, device_id="{_esc(device_id)}"}}', since, 10)
    incident_rows = await _logs(client, f'{{agent="incident"}} |= "{_esc(device_id)}"', "30d", 10)
    # Pull category/model from the most recent alarm row.
    meta = (alarm_rows[0].get("labels") if alarm_rows else {}) or {}
    return {
        "function": "device_health",
        "device_id": device_id,
        "category": meta.get("category"),
        "model": meta.get("model"),
        "metrics": latest,
        "open_alarms": open_alarms,
        "recent_alarms": [_alarm_row(r) for r in alarm_rows],
        "related_incidents": [_incident_row(r) for r in incident_rows],
    }


async def _attack_types(client: LokiClient, p: dict) -> dict:
    """The SOC threat feed broken down by attack_type (bruteforce, ransomware,
    malware, phishing, port_scan, vpn_failure, firewall_block)."""
    since = p.get("since") or "24h"
    norm = await _instant(client, f'sum by (attack_type) (count_over_time({{attack_type=~".+"}}{_range(since)}))')
    types = [{"attack_type": name, "count": int(val)} for name, val in _vector_pairs(norm) if name and name != "value"]
    return {"function": "attack_types", "since": since, "types": types, "total": sum(t["count"] for t in types)}


async def _threats_by_country(client: LokiClient, p: dict) -> dict:
    """Blocked-threat origin by country code — for the geographic threat panel."""
    since = p.get("since") or "24h"
    norm = await _instant(client, f'sum by (country) (count_over_time({{country=~".+"}}{_range(since)}))')
    countries = [{"country": name, "count": int(val)} for name, val in _vector_pairs(norm) if name and name != "value"]
    return {"function": "threats_by_country", "since": since, "countries": countries, "total": sum(c["count"] for c in countries)}


async def _branch_health(client: LokiClient, p: dict) -> dict:
    """Latest per-branch health snapshot (status UP/DOWN + critical/warning counts +
    lat/lon) from the ai-agent `branch_health` stream — newest line per branch_code."""
    since = p.get("since") or "24h"
    rows = await _logs(client, '{agent="branch_health"}', since, 400)
    seen: dict[str, dict] = {}
    for r in rows:  # rows are newest→oldest, so the first per code is the latest
        pj = r.get("parsed") or {}
        code = pj.get("code") or (r.get("labels") or {}).get("branch_code")
        if not code or code in seen:
            continue
        seen[code] = {
            "code": code,
            "branch": pj.get("branch"),
            "status": str(pj.get("status") or "").upper(),
            "lat": pj.get("lat"),
            "lon": pj.get("lon"),
            "critical": int(pj.get("critical") or 0),
            "warning": int(pj.get("warning") or 0),
            "ts": r.get("ts"),
        }
    branches = sorted(seen.values(), key=lambda b: b["critical"], reverse=True)
    down = sum(1 for b in branches if b["status"] == "DOWN")
    return {
        "function": "branch_health", "since": since, "branches": branches,
        "total": len(branches), "down": down, "up": len(branches) - down,
    }


# device_id prefix → asset type (matches the Assets filter chips). Checked in order.
_TYPE_PREFIX: list[tuple[str, tuple[str, ...]]] = [
    ("atm", ("ATM-",)),
    ("router", ("RTR-", "ROUTER")),
    ("switch", ("SW-", "SWT-", "SWITCH")),
    ("server", ("SRV-", "APP-", "DB-", "EXCH-", "WSUS-")),
    ("vm", ("VM-", "VMW-")),
    ("network", ("FW-", "VPN-", "AP-", "WLC-", "GW-", "LB-")),
]


def _device_type(name: str, category: str | None) -> str:
    n = (name or "").upper()
    for t, prefixes in _TYPE_PREFIX:
        if any(n.startswith(pre) for pre in prefixes):
            return t
    cat = (category or "").lower()
    if cat in ("network", "security", "wireless"):
        return "network"
    if cat in ("server", "application", "platform", "storage"):
        return "server"
    if cat == "cloud":
        return "vm"
    return "host"


def _device_location(name: str) -> str | None:
    """The middle segment(s) of a device id (TYPE-<location>-NN) as a location hint."""
    parts = [p for p in (name or "").split("-") if p]
    if len(parts) >= 3:
        mid = "-".join(parts[1:-1])
        return mid or None
    return None


async def _asset_inventory(client: LokiClient, p: dict) -> dict:
    """Per-device asset inventory for the Assets page + Device Availability KPI.

    Devices = union of those seen in monitoring alarms (which carry category/model
    /severity) and those reporting metrics (telemetry-only devices). Status is the
    device's DOMINANT (highest-volume) alarm severity over the window — info-heavy
    devices read 'up', warning-heavy 'degraded', critical-heavy 'down' — which gives
    a realistic availability spread (every device has *some* criticals, so presence
    of a critical alone can't mean 'down')."""
    since = p.get("since") or "24h"
    rng = _range(since)
    # device_id / category / model live ONLY on manageengine (solarwinds keys by
    # `node`), and scoping to it keeps the inner series under Loki's 500 cap.
    dev_source = 'source="manageengine"'
    devices: dict[str, dict] = {}

    def dev(did: str) -> dict:
        return devices.setdefault(did, {"name": did, "category": None, "model": None, "sev_counts": {}, "alarms": 0})

    # 1) Severity volume per device.
    sev_rows = await _instant_raw(client, f"sum by (device_id, severity) (count_over_time({{{dev_source}}}{rng}))")
    for e in sev_rows:
        m = e.get("metric") or {}
        did = m.get("device_id")
        if not did:
            continue
        try:
            cnt = int(float((e.get("value") or [0, "0"])[1]))
        except (ValueError, TypeError):
            cnt = 0
        d = dev(did)
        sev = _norm_sev(m.get("severity"))
        if sev:
            d["sev_counts"][sev] = d["sev_counts"].get(sev, 0) + cnt
        d["alarms"] += cnt

    # 2) category/model per device (one row per device → low cardinality).
    meta_rows = await _instant_raw(client, f"count by (device_id, category, model) (count_over_time({{{dev_source}}}{rng}))")
    for e in meta_rows:
        m = e.get("metric") or {}
        did = m.get("device_id")
        if not did:
            continue
        d = dev(did)
        if m.get("category") and not d["category"]:
            d["category"] = m["category"]
        if m.get("model") and not d["model"]:
            d["model"] = m["model"]

    # 3) Telemetry-only devices (reporting metrics but no alarms).
    metric_rows = await _instant_raw(client, f'count by (device_id) (count_over_time({{metric=~".+"}}{rng}))')
    for e in metric_rows:
        did = (e.get("metric") or {}).get("device_id")
        if did:
            dev(did)

    assets: list[dict] = []
    for d in devices.values():
        sc = d["sev_counts"]
        # Bucket high/medium with warning, low with info, for a 3-way status call.
        crit = sc.get("critical", 0)
        warn = sc.get("warning", 0) + sc.get("high", 0) + sc.get("medium", 0)
        info = sc.get("info", 0) + sc.get("low", 0)
        dominant = max((("critical", crit), ("warning", warn), ("info", info)), key=lambda kv: kv[1])[0] if (crit or warn or info) else None
        status = "down" if dominant == "critical" else ("degraded" if dominant == "warning" else "up")
        assets.append({
            "name": d["name"],
            "type": _device_type(d["name"], d["category"]),
            "ip": None,
            "location": _device_location(d["name"]),
            "category": d["category"],
            "model": d["model"],
            # Severity reflects the dominant state (aligned with status), not the
            # worst alarm ever seen — every device logs *some* criticals.
            "severity": dominant,
            "status": status,
            "alarms": d["alarms"],
        })

    # Down first, then degraded, then by alarm volume — most actionable on top.
    order = {"down": 0, "degraded": 1, "up": 2}
    assets.sort(key=lambda a: (order.get(a["status"], 3), -a["alarms"], a["name"]))
    online = sum(1 for a in assets if a["status"] == "up")
    degraded = sum(1 for a in assets if a["status"] == "degraded")
    offline = sum(1 for a in assets if a["status"] == "down")
    total = len(assets)
    by_type: dict[str, int] = {}
    for a in assets:
        by_type[a["type"]] = by_type.get(a["type"], 0) + 1
    return {
        "function": "asset_inventory", "since": since, "assets": assets,
        "total": total, "online": online, "degraded": degraded, "offline": offline,
        "availability_pct": round(100 * online / total, 1) if total else 0.0,
        "by_type": [{"type": k, "count": v} for k, v in sorted(by_type.items(), key=lambda x: -x[1])],
    }


async def _security_events(client: LokiClient, p: dict) -> dict:
    """SOC posture: security-category alarms by (normalized) severity, plus the
    blocked-threat feed summary (by attack_type and origin country)."""
    since = p.get("since") or "24h"
    rng = _range(since)
    sev_norm = await _instant(client, f'sum by (severity) (count_over_time({{{ALARM_SOURCES}, category="security"}}{rng}))')
    by_sev = _merge_sev(_vector_pairs(sev_norm))
    attacks = await _attack_types(client, p)
    threats = await _threats_by_country(client, p)
    return {
        "function": "security_events", "since": since,
        "security_alarms_by_severity": by_sev,
        "security_alarms_total": sum(s["count"] for s in by_sev),
        "threats_blocked": attacks["total"],
        "attack_types": attacks["types"],
        "top_countries": threats["countries"][:8],
    }


async def _search_logs(client: LokiClient, p: dict) -> dict:
    """Grounded generic search: build a selector from explicit label filters
    (the 'use existing query' path) rather than free-form LogQL."""
    since = p.get("since") or "24h"
    limit = int(p.get("limit") or 50)
    filters = p.get("label_filters") or []
    matchers = []
    for f in filters:
        label, op, value = f.get("label"), f.get("op") or "=", f.get("value")
        if label and value and op in ("=", "!=", "=~", "!~"):
            matchers.append(f'{label}{op}"{_esc(value)}"')
    if not matchers:
        matchers.append('service_name=~".+"')
    sel = "{" + ", ".join(matchers) + "}"
    line = (p.get("line_filter") or "").strip()
    if line:
        sel = f'{sel} |= "{_esc(line)}"'
    rows = await _logs(client, sel, since, limit)
    compact = [{"ts": r.get("ts"), "severity": r.get("severity"), "device_id": (r.get("labels") or {}).get("device_id"),
                "message": r.get("message") or r.get("line")} for r in rows]
    return {"function": "search_logs", "logql": sel, "since": since, "count": len(compact), "rows": compact}


# ── SOC (security operations) ────────────────────────────────────────────────
# The security-telemetry feeds, distinct from the NOC alarm/metric feeds. Each is
# a JSON-line stream keyed by `source`; severity casing varies per feed (FortiSIEM
# UPPER, Sentinel Title) so it's always lower-cased on the way out. A separate
# logfmt sub-stream under source=sentinel carries the blocked-threat feed
# (attack_type/country/action) — handled by attack_types / threats_by_country.
SOC_SOURCES = ("fortisiem", "sentinel", "darknet", "windows", "firewall", "edr")
_SOC_SELECTOR = 'source=~"' + "|".join(SOC_SOURCES) + '"'

# Per-source whitelist of JSON fields safe to aggregate / surface. Keeps
# soc_top_fields from being a free-form (and injectable) field selector.
_SOC_FIELDS: dict[str, tuple[str, ...]] = {
    "fortisiem": ("mitre_technique", "category", "rule_name", "user", "host", "event_id"),
    "sentinel":  ("tactics", "country", "workspace", "user", "alert_name", "rule_id"),
    "darknet":   ("threat_actor", "indicator_type", "confidence", "platform"),
    "windows":   ("event_id", "process", "user", "host", "logon_type", "domain"),
    "firewall":  ("action", "protocol", "dst_port", "src_ip", "dst_ip", "rule"),
    "edr":       ("host", "severity"),
}

# JSON keys flattened onto each row returned by soc_recent_events (when present).
_SOC_FLATTEN = (
    "event_id", "mitre_technique", "tactics", "threat_actor", "indicator_type", "ioc_value",
    "process", "action", "protocol", "src_ip", "dst_ip", "dst_port", "country", "rule_name",
    "rule_id", "alert_name", "platform", "confidence", "workspace", "logon_type", "bytes",
)


async def _soc_summary(client: LokiClient, p: dict) -> dict:
    """SOC overview: per-source volume + severity matrix, overall severity tally,
    and the headline KPIs the Security Operations dashboard leads with."""
    since = p.get("since") or "24h"
    rng = _range(since)
    rows = await _instant_raw(client, f"sum by (source, severity) (count_over_time({{{_SOC_SELECTOR}}}{rng}))")
    by_src: dict[str, dict[str, int]] = {s: {} for s in SOC_SOURCES}
    for e in rows:
        m = e.get("metric") or {}
        src = m.get("source")
        if src not in by_src:
            continue
        sev = _norm_sev(m.get("severity"))
        try:
            cnt = int(float((e.get("value") or [0, "0"])[1]))
        except (ValueError, TypeError):
            cnt = 0
        if sev:
            by_src[src][sev] = by_src[src].get(sev, 0) + cnt

    sources = [{
        "source": src,
        "total": sum(by_src[src].values()),
        "by_severity": _merge_sev(list(by_src[src].items())),
    } for src in SOC_SOURCES]

    def src_sev(name: str, *sevs: str) -> int:
        sev = by_src.get(name, {})
        return sum(sev.get(s, 0) for s in sevs)

    sev_tot: dict[str, int] = {}
    for sev in by_src.values():
        for k, v in sev.items():
            sev_tot[k] = sev_tot.get(k, 0) + v

    threats = await _attack_types(client, p)
    return {
        "function": "soc_summary", "since": since,
        "sources": sources,
        "total": sum(s["total"] for s in sources),
        "by_severity": _merge_sev(list(sev_tot.items())),
        "kpis": {
            "siem_critical_high": src_sev("fortisiem", "critical", "high"),
            "darknet_iocs": src_sev("darknet", "critical", "high", "medium", "low"),
            "sentinel_alerts": next((s["total"] for s in sources if s["source"] == "sentinel"), 0),
            "windows_alerts": src_sev("windows", "error", "warning"),
            "firewall_denies": src_sev("firewall", "deny", "alert"),
            "edr_events": next((s["total"] for s in sources if s["source"] == "edr"), 0),
            "threats_blocked": threats["total"],
        },
    }


async def _soc_event_trend(client: LokiClient, p: dict) -> dict:
    """Security event volume over time, grouped by source (clamped to 30d)."""
    since = p.get("since") or "24h"
    start_ns, end_ns = _window_scan(since)
    step_s = max(_clamp_secs(since) // 120, 300)
    step = f"{step_s}s"
    logql = f"sum by (source) (count_over_time({{{_SOC_SELECTOR}}}[{step}]))"
    raw = await client.query_range(logql, start_ns=start_ns, end_ns=end_ns, step=step, limit=100)
    norm = client.normalize(raw)
    return {"function": "soc_event_trend", "since": since, "step": step, "series": norm.get("series") or []}


async def _soc_top_fields(client: LokiClient, p: dict) -> dict:
    """Top values of a whitelisted JSON field for one SOC source (e.g. fortisiem
    mitre_technique, sentinel tactics, windows event_id, firewall dst_port)."""
    source = (p.get("source") or "").strip().lower()
    field = (p.get("field") or "").strip()
    if source not in _SOC_FIELDS:
        raise ValueError(f"source must be one of: {', '.join(_SOC_FIELDS)}")
    if field not in _SOC_FIELDS[source]:
        raise ValueError(f"field must be one of {_SOC_FIELDS[source]} for source '{source}'")
    since = p.get("since") or "24h"
    limit = int(p.get("limit") or 10)
    # JSON-parsing aggregation — clamp the window to the 30d server scan limit.
    logql = f'sum by ({field}) (count_over_time({{source="{source}"}} | json | {field}!="" {_range_scan(since)}))'
    norm = await _instant(client, logql)
    items = [{"value": name, "count": int(val)} for name, val in _vector_pairs(norm) if name and name != "value"][:limit]
    return {"function": "soc_top_fields", "source": source, "field": field, "since": since,
            "items": items, "total": sum(i["count"] for i in items)}


async def _soc_recent_events(client: LokiClient, p: dict) -> dict:
    """Recent parsed security events across SOC sources (or one source), with the
    key per-feed JSON fields flattened onto each row."""
    since = p.get("since") or "24h"
    limit = min(int(p.get("limit") or 50), 200)
    source = (p.get("source") or "").strip().lower()
    sel = f'{{source="{source}"}}' if source in _SOC_FIELDS else f"{{{_SOC_SELECTOR}}}"
    sm = _sev_matcher(p.get("severity"))
    if sm:
        sel = sel[:-1] + ", " + sm + "}"
    line = (p.get("line_filter") or "").strip()
    if line:
        sel = f'{sel} |= "{_esc(line)}"'
    rows = await _logs(client, sel, since, limit)
    out: list[dict] = []
    for r in rows:
        pj = r.get("parsed") or {}
        labels = r.get("labels") or {}
        rec = {
            "ts": r.get("ts"),
            "source": labels.get("source"),
            "severity": _norm_sev(labels.get("severity") or pj.get("severity")),
            "host": labels.get("host") or pj.get("host") or pj.get("node") or labels.get("node"),
            "user": pj.get("user"),
            "message": pj.get("message") or r.get("line"),
        }
        for k in _SOC_FLATTEN:
            v = pj.get(k)
            if v not in (None, ""):
                rec[k] = v
        out.append(rec)
    return {"function": "soc_recent_events", "since": since, "source": source or None,
            "count": len(out), "rows": out}


def _scalar(norm: dict) -> int:
    pairs = _vector_pairs(norm)
    return int(pairs[0][1]) if pairs else 0


def _cfg_pct(name: str, default: float) -> float:
    """An externally-sourced posture metric (compliance, MTTR/MTTD, domain health)
    — these come from SOC tooling, not the Loki telemetry, so they're configurable
    via env with a sensible default."""
    try:
        return float(os.environ.get(name) or default)
    except (TypeError, ValueError):
        return default


async def _soc_threat_trend(client: LokiClient, p: dict) -> dict:
    """Blocked-threat volume over time (the SOC 'threat trends' chart)."""
    since = p.get("since") or "24h"
    start_ns, end_ns = _window_scan(since)
    step_s = max(_clamp_secs(since) // 120, 300)
    step = f"{step_s}s"
    raw = await client.query_range(f'sum(count_over_time({{attack_type=~".+"}}[{step}]))',
                                   start_ns=start_ns, end_ns=end_ns, step=step, limit=10)
    series = client.normalize(raw).get("series") or []
    for s in series:
        s["name"] = "threats"
    return {"function": "soc_threat_trend", "since": since, "step": step, "series": series}


async def _soc_posture(client: LokiClient, p: dict) -> dict:
    """Executive SOC posture for the dashboard headline. REAL signals from Loki:
    security_incidents, malicious_queries (darknet indicators), firewall infra
    availability. CONFIGURED (from SOC tooling, not the telemetry): MTTD/MTTR,
    patch & antivirus compliance, domain health — overridable via env."""
    since = p.get("since") or "24h"
    rng = _range(since)
    security_incidents = _scalar(await _instant(client, f'sum(count_over_time({{agent="incident", incident_type="security"}}{rng}))'))
    malicious_queries = _scalar(await _instant(client, f'sum(count_over_time({{source="darknet"}}{rng}))'))
    # Firewall infrastructure availability from the per-device asset inventory.
    inv = await _asset_inventory(client, {"since": since})
    fw = [a for a in inv.get("assets", []) if (a.get("name") or "").upper().startswith("FW")]
    fw_up = sum(1 for a in fw if a.get("status") == "up")
    fw_avail = round(100 * fw_up / len(fw), 1) if fw else 0.0
    return {
        "function": "soc_posture", "since": since,
        "security_incidents": security_incidents,
        "malicious_queries": malicious_queries,
        "firewall_availability_pct": fw_avail,
        "firewall_total": len(fw),
        "firewall_up": fw_up,
        "mttd_minutes": _cfg_pct("SOC_MTTD_MIN", 7.0),
        "mttr_minutes": _cfg_pct("SOC_MTTR_MIN", 42.0),
        "patch_compliance_pct": _cfg_pct("SOC_PATCH_COMPLIANCE", 99.0),
        "av_compliance_pct": _cfg_pct("SOC_AV_COMPLIANCE", 99.0),
        "domain_health_pct": _cfg_pct("SOC_DOMAIN_HEALTH", 98.0),
        # Which fields are configured (not from Loki) — the UI flags these.
        "configured": ["mttd_minutes", "mttr_minutes", "patch_compliance_pct", "av_compliance_pct", "domain_health_pct"],
    }


# ── NOC (network operations) deep-dive ───────────────────────────────────────
# The monitoring-alarm feeds (solarwinds = primary alarm stream w/ device_id/model
# /site_code/category/severity labels + JSON {alert_id,status,message}; manageengine
# similar). A small solarwinds sub-stream also carries node telemetry (cpu_pct/
# mem_pct/bandwidth_pct/latency_ms). These power the NOC deep-dive breakdowns.


async def _noc_alarm_analytics(client: LokiClient, p: dict) -> dict:
    """NOC alarm analytics: monitoring-alarm volume broken down by source,
    category, severity, hardware model, site, and open/resolved status."""
    since = p.get("since") or "24h"
    rng = _range(since)

    async def by_label(label: str) -> list[dict]:
        norm = await _instant(client, f"sum by ({label}) (count_over_time({{{ALARM_SOURCES}}}{rng}))")
        return [{"key": n, "count": int(v)} for n, v in _vector_pairs(norm) if n and n != "value"]

    by_source = await by_label("source")
    by_category = await by_label("category")
    by_model = (await by_label("model"))[:12]
    by_site = await by_label("site_code")
    sev_norm = await _instant(client, f"sum by (severity) (count_over_time({{{ALARM_SOURCES}}}{rng}))")
    by_severity = _merge_sev(_vector_pairs(sev_norm))
    # status (open/resolved/acknowledged) lives in the JSON line — scoped to
    # manageengine (fast, representative) and clamped to the 30d scan limit.
    st_norm = await _instant(client, f'sum by (status) (count_over_time({{source="manageengine"}} | json | status!="" {_range_scan(since)}))')
    by_status = [{"key": n, "count": int(v)} for n, v in _vector_pairs(st_norm) if n and n != "value"]

    return {
        "function": "noc_alarm_analytics", "since": since,
        "total": sum(s["count"] for s in by_source),
        "by_source": by_source, "by_category": by_category, "by_severity": by_severity,
        "by_model": by_model, "by_site": by_site, "by_status": by_status,
    }


async def _top_alarming_devices(client: LokiClient, p: dict) -> dict:
    """Devices generating the most monitoring alarms — manageengine/solarwinds
    `device_id` plus the solarwinds node-telemetry `node`, merged and ranked."""
    since = p.get("since") or "24h"
    limit = int(p.get("limit") or 12)
    rng = _range(since)
    tally: dict[str, int] = {}
    for label in ("device_id", "node"):
        norm = await _instant(client, f"sum by ({label}) (count_over_time({{{ALARM_SOURCES}}}{rng}))")
        for n, v in _vector_pairs(norm):
            if n and n != "value":
                tally[n] = tally.get(n, 0) + int(v)
    devices = sorted(({"device": k, "count": v} for k, v in tally.items()), key=lambda d: d["count"], reverse=True)[:limit]
    return {"function": "top_alarming_devices", "since": since, "devices": devices, "total": sum(d["count"] for d in devices)}


_SW_NODE_METRICS = ("cpu_pct", "mem_pct", "bandwidth_pct", "latency_ms")


async def _noc_node_performance(client: LokiClient, p: dict) -> dict:
    """SolarWinds core-node telemetry: average CPU%, memory%, bandwidth% and
    latency(ms) per monitored node (the node-level perf sub-stream)."""
    since = p.get("since") or "24h"
    scan = _range_scan(since)
    nodes: dict[str, dict] = {}
    for m in _SW_NODE_METRICS:
        norm = await _instant(client, f'avg by (node) (avg_over_time({{source="solarwinds"}} | json | unwrap {m} {scan}))')
        for n, v in _vector_pairs(norm):
            if n and n != "value":
                nodes.setdefault(n, {"node": n})[m] = round(v, 2)
    out = sorted(nodes.values(), key=lambda d: d.get("cpu_pct") or 0, reverse=True)
    return {"function": "noc_node_performance", "since": since, "nodes": out}


# ── registry + specs ───────────────────────────────────────────────────────

RunFn = Callable[[LokiClient, dict], Awaitable[dict]]


class NocFunction:
    def __init__(self, name: str, description: str, params: list[dict], run: RunFn) -> None:
        self.name = name
        self.description = description
        self.params = params
        self.run = run

    def spec(self) -> dict:
        return {"name": self.name, "description": self.description, "params": self.params}


def _p(name: str, type_: str, required: bool, description: str) -> dict:
    return {"name": name, "type": type_, "required": required, "description": description}

_SINCE = _p("since", "string", False, "Relative lookback window, e.g. 1h, 6h, 24h, 7d, 30d. Default 24h.")

NOC_FUNCTIONS: dict[str, NocFunction] = {f.name: f for f in [
    NocFunction("device_inventory", "Count of monitored devices per category (network, security, server, …) and the total fleet size. Use for device-availability / inventory questions.",
                [_SINCE], _device_inventory),
    NocFunction("events_by_category", "Total monitoring alarm volume grouped by category over the window.",
                [_SINCE], _events_by_category),
    NocFunction("alarm_trend", "Alarm volume over time grouped by severity — for the availability/alarm-volume trend chart.",
                [_SINCE, _p("category", "string", False, "Optional category filter."), _p("device_id", "string", False, "Optional device filter.")], _alarm_trend),
    NocFunction("alarms_by_severity", "Alarm counts grouped by severity (critical/high/warning/info). Optionally scope to a category or device_id.",
                [_SINCE, _p("category", "string", False, "Optional category filter."), _p("device_id", "string", False, "Optional device filter.")], _alarms_by_severity),
    NocFunction("top_alarms", "Most recent alarms (default critical) as structured rows: device, model, category, severity, status, message. Use for the 'top critical alarms' table.",
                [_SINCE, _p("severity", "string", False, "Severity to filter, default 'critical'."), _p("category", "string", False, "Optional category."), _p("limit", "number", False, "Max rows, default 15.")], _top_alarms),
    NocFunction("incidents", "AI-correlated incidents (the NOC incident queue) with severity tally. Use for incident-summary / recent-incidents questions.",
                [_SINCE, _p("severity", "string", False, "Optional severity filter."), _p("incident_type", "string", False, "Optional type: network/security."), _p("limit", "number", False, "Max incidents, default 20.")], _incidents),
    NocFunction("incident_detail", "FULL diagnosis for one incident_id: summary, severity, affected assets, root-cause analysis, evidence, recommended actions, escalation team, and the raw correlated logs. Use to 'diagnose'/'investigate' a specific incident.",
                [_p("incident_id", "string", True, "The incident id, e.g. INC-eb820824b6."), _p("since", "string", False, "Lookback for correlated logs, default 30d.")], _incident_detail),
    NocFunction("recent_incident_traces", "List of recent MAJOR incidents (critical+high) available to trace, with a by_type tally. The real-time feed for the Traces view; filter by incident_type (network/security).",
                [_SINCE, _p("incident_type", "string", False, "Optional: network | security | unknown."), _p("severity", "string", False, "Optional exact severity; default returns critical+high."), _p("limit", "number", False, "Max incidents, default 30.")], _recent_incident_traces),
    NocFunction("incident_trace", "Reconstruct ONE incident's WATERFALL trace: the affected device's correlated precursor events (real timeline) → AI diagnosis phases (detection → root cause → recommendation), as ordered spans with offsets/durations. Use to trace/investigate how an incident unfolded.",
                [_p("incident_id", "string", True, "The incident id, e.g. INC-eb820824b6."), _p("window", "string", False, "Lookback around the incident for precursor events, default 2h.")], _incident_trace),
    NocFunction("early_warnings", "AI anomaly / early-warning signals (brute-force attempts, metric spikes) with observed vs threshold.",
                [_SINCE, _p("limit", "number", False, "Max warnings, default 15.")], _early_warnings),
    NocFunction("top_devices_by_metric", "Top-N devices ranked by a performance metric. metric ∈ {cpu_utilization_percent, interface_utilization_percent, latency_ms}. Use for 'top CPU', 'highest link utilization', 'worst latency'.",
                [_p("metric", "string", True, "cpu_utilization_percent | interface_utilization_percent | latency_ms"), _p("agg", "string", False, "avg|max|min, default avg."), _p("limit", "number", False, "Top N, default 10."), _SINCE], _top_devices_by_metric),
    NocFunction("metric_trend", "Time-series trend of a performance metric — for one device_id, or the fleet average if omitted. Use for plotting CPU/latency/utilization over time.",
                [_p("metric", "string", True, "cpu_utilization_percent | interface_utilization_percent | latency_ms"), _p("device_id", "string", False, "Optional device; omit for fleet average."), _p("agg", "string", False, "avg|max|min, default avg."), _SINCE], _metric_trend),
    NocFunction("device_health", "Health snapshot for one device: latest CPU/interface/latency, open-alarm count, recent alarms, and related incidents. Use to investigate a specific device.",
                [_p("device_id", "string", True, "The device id, e.g. SRV-DC1-MUM-07."), _SINCE], _device_health),
    NocFunction("security_events", "SOC posture: security-category alarms by severity, blocked-threat total, attack_type breakdown and top origin countries. Use for the security panel / 'security summary'.",
                [_SINCE], _security_events),
    NocFunction("attack_types", "Blocked SOC threats broken down by attack_type (bruteforce, ransomware, malware, phishing, port_scan, vpn_failure, firewall_block). Use for 'what attacks are we seeing'.",
                [_SINCE], _attack_types),
    NocFunction("threats_by_country", "Blocked-threat volume by origin country code (RU/CN/IN/…). Use for the geographic threat panel / 'where are attacks coming from'.",
                [_SINCE], _threats_by_country),
    NocFunction("branch_health", "Latest per-branch health: status (UP/DOWN), critical & warning counts, and lat/lon, from the ai-agent branch_health feed. Use for branch availability / the branch map.",
                [_SINCE], _branch_health),
    NocFunction("asset_inventory", "Per-device asset inventory: name, type (atm/router/switch/server/network/vm/host), location, model, worst severity, alarm volume, and status (up/degraded/down by dominant alarm severity). Includes availability totals (online/degraded/offline + availability_pct). Use for the Assets page and the Device Availability KPI.",
                [_SINCE], _asset_inventory),
    NocFunction("search_logs", "Grounded log search built from explicit label filters (no free-form LogQL). label_filters: [{label, op, value}]. Use when a structured function above doesn't fit but you still want safe, label-scoped results.",
                [_p("label_filters", "object", False, "Array of {label, op(=,!=,=~,!~), value}."), _p("line_filter", "string", False, "Optional substring the line must contain."), _SINCE, _p("limit", "number", False, "Max rows, default 50.")], _search_logs),
    NocFunction("soc_summary", "Security Operations (SOC) overview: per-source event volume + severity breakdown for the security feeds (fortisiem/sentinel/darknet/windows/firewall/edr), overall severity tally, and headline KPIs (SIEM critical+high, darknet IOCs, sentinel cloud alerts, windows endpoint alerts, firewall denies, threats blocked). Use for the SOC dashboard overview / 'security operations summary'.",
                [_SINCE], _soc_summary),
    NocFunction("soc_event_trend", "Security event volume over time grouped by source — the SOC event-volume trend chart.",
                [_SINCE], _soc_event_trend),
    NocFunction("soc_top_fields", "Top values of a security field for one SOC source: fortisiem→mitre_technique/category/rule_name, sentinel→tactics/country/workspace, darknet→threat_actor/indicator_type/platform, windows→event_id/process, firewall→action/protocol/dst_port. Use for SOC breakdown bars ('top MITRE techniques', 'which event IDs', 'attacker tactics').",
                [_p("source", "string", True, "SOC source: fortisiem|sentinel|darknet|windows|firewall|edr."), _p("field", "string", True, "JSON field to break down (must be valid for the source)."), _p("limit", "number", False, "Top N, default 10."), _SINCE], _soc_top_fields),
    NocFunction("soc_recent_events", "Recent parsed security log events across all SOC sources or one source, with the key per-feed fields flattened (mitre_technique, tactics, threat_actor, ioc_value, event_id, process, action, src/dst ip, dst_port, country). Use for the SOC log-stream tables / 'show recent security events'.",
                [_p("source", "string", False, "Optional SOC source filter."), _p("severity", "string", False, "Optional severity filter."), _p("line_filter", "string", False, "Optional substring the line must contain."), _p("limit", "number", False, "Max rows, default 50."), _SINCE], _soc_recent_events),
    NocFunction("noc_alarm_analytics", "NOC alarm analytics for the network-operations deep-dive: monitoring-alarm volume broken down by source (solarwinds/manageengine), category (network/server/wireless/…), severity, hardware model, site_code, and open/resolved status. Use for 'break down the alarms', 'which models/sites alarm most', alarm posture.",
                [_SINCE], _noc_alarm_analytics),
    NocFunction("top_alarming_devices", "The noisiest devices — those generating the most monitoring alarms over the window (device_id + node), ranked. Use for 'which devices alarm the most' / loudest devices.",
                [_SINCE, _p("limit", "number", False, "Top N, default 12.")], _top_alarming_devices),
    NocFunction("noc_node_performance", "SolarWinds core-node telemetry: average CPU%, memory%, bandwidth% and latency(ms) per monitored core node (Core-SW-01, DC-Router-03, FW-Edge-02, VPN-GW-01, WAN-LDN-01). Use for core network-node health.",
                [_SINCE], _noc_node_performance),
    NocFunction("soc_threat_trend", "Blocked-threat volume over time (the SOC threat-trends chart).",
                [_SINCE], _soc_threat_trend),
    NocFunction("soc_posture", "Executive SOC posture: security incidents, malicious indicators, firewall infrastructure availability (REAL, from Loki) plus MTTD/MTTR, patch & antivirus compliance and domain health (CONFIGURED from SOC tooling, not the telemetry). Use for the SOC posture/compliance KPIs.",
                [_SINCE], _soc_posture),
]}


def function_specs() -> list[dict]:
    return [fn.spec() for fn in NOC_FUNCTIONS.values()]


async def run_function(client: LokiClient, name: str, params: dict) -> dict:
    fn = NOC_FUNCTIONS.get(name)
    if fn is None:
        raise KeyError(name)
    return await fn.run(client, params or {})
