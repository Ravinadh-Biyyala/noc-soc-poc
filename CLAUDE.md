# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A **NOC/SOC operations analytics** app over a Grafana Loki source, with a global
**dark NOC theme**. Four pages:
- **Dashboard** (`/dashboard`, the landing route) — a unified, live NOC overview:
  KPI strip (devices, alarms, incidents, security), device-availability donut,
  top critical-alarms table, AI incident summary + recent incidents, alarm-volume
  trend, top CPU / link-utilization / latency rankings, a device-fabric topology
  map, a geographic threat map, and a security-posture panel. **Every high-level
  metric is clickable to drill into a deep diagnosis** via an in-page slide-over
  (`DiagnosisDrawer`): incident → root-cause + recommendation + evidence → affected
  device → device health (CPU/link/latency trend, alarms, related incidents), with
  back-stack navigation. Live auto-refresh + time ranges up to 90 days.
- **Traces** (`/loki-traces`) — the investigation view. A live feed of major
  incidents (critical+high) tabbed by `incident_type` (NOC=network / SOC=security);
  clicking one shows its reconstructed **waterfall trace** — the affected device's
  correlated precursor events (real timeline) culminating in the AI
  detection→root-cause→recommendation phases — plus the diagnosis card. Polls Loki
  (Live toggle) so new majors surface in real time. Deep-link: `?incident=<id>`.
- **Loki Logs** (`/loki-logs`) and **Pinned Visuals** (`/loki-pins`) — see below.

The Loki source is a **NOC/SOC telemetry feed** (~113 monitored devices), JSON
log lines:
- **Device metrics** — `{metric="cpu_utilization_percent|interface_utilization_percent|latency_ms", device_id}`, line `{"value": N}` (aggregate with `| json | unwrap value`).
- **Monitoring alarms** — `{source="solarwinds|manageengine", category, device_id, model, severity}`, line `{"alert_id","status","message"}`.
- **AI diagnosis stream** — `{source="ai-agent", agent="incident|rca|recommendation|anomaly|summary", incident_type, severity}`, rich JSON keyed by `incident_id`.
- Legacy Linux **syslog** (`job="system"`, `filename`) with an SSH brute-force →
  surfaced in the Security panel.

The **Loki Logs** explorer screen:
- A Grafana-style **Explorer** subtab: dynamic label filters (`label`/operator/value),
  a line filter, a time range, and a paginated log table.
- A **Pinned Visuals** subtab: charts the AI pinned from chat.
- A right-rail **BI Companion** chat (CopilotKit / AG-UI). The agent calls
  **canonical NOC functions** (not hand-written LogQL) and renders structured
  cards/charts inline; raw LogQL is a fallback only. See "The AI chat" below.

> History: this repo was originally a multi-tenant BI dashboard. All of that
> (Home/Projects/Dashboards/Visuals Catalog/Reports/Governance/Settings, the AI
> data pipeline, tenant config, datasets, connectors, Salesforce, etc.) has been
> removed. Some shared workspace `lib/*` packages and unused npm dependencies
> remain in place to keep the monorepo build graph intact.

## Commands

```bash
# Start everything (API on :8080, dashboard on :5173)
pnpm dev

# Individual services
pnpm dev:api          # API server only
pnpm dev:web          # Frontend only

# Python Loki service (FastAPI) on :8000
cd services/agents-py && python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt && .venv/Scripts/python run.py
# Set AGENTS_SERVICE_URL=http://localhost:8000 in .env so Express proxies /api/loki to it.

# Production build (typecheck + all packages)
pnpm build

# Type checking
pnpm typecheck
```

No test suite exists in this codebase.

## Environment Variables

Copy `.env.example` to `.env`. Required:
- `SESSION_SECRET` — Random string for session signing
- `OPENAI_API_KEY` — OpenAI key for the BI Companion chat (gpt-4.1-mini)
- `AGENTS_SERVICE_URL` — URL of the Python Loki service (e.g. `http://localhost:8000`)
- `LOKI_URL` — The Loki server to read logs from

Optional: `OPENAI_MODEL`, `PORT` (API port, default `8080`), `API_PROXY_TARGET`
(frontend proxy target, default `http://localhost:8080`), `LOKI_TIMEOUT`,
`LOKI_LABEL_WINDOW`.

- `LOKI_DATABASE_URL` — Postgres for **pinned visuals**. The Express server stores
  pinned charts + their query metadata in a dedicated database named `loki`,
  created automatically on first use (default
  `postgresql://postgres:postgres@localhost:5432/loki`). This is the only
  Postgres the app uses.

## Architecture

**pnpm monorepo** with two deployable apps plus a standalone Python service.

### `services/agents-py` — Python Loki service (FastAPI)

Read-only proxy/query layer over the Grafana Loki HTTP API. Self-contained over
`httpx` (no DB, no LangChain). Key files:
- `app/loki/client.py` — async Loki client; `query_range`/`query_instant`;
  normalizes `streams` → log rows and `matrix`/`vector` → Recharts-ready series.
- `app/loki/noc.py` — **canonical NOC function registry** (`NOC_FUNCTIONS`): named,
  parameterised functions each wrapping a validated LogQL query and returning
  structured JSON (device_inventory, alarms_by_severity, alarm_trend, top_alarms,
  incidents, incident_detail, early_warnings, top_devices_by_metric, metric_trend,
  device_health, security_events, search_logs, and the **tracing** pair
  recent_incident_traces / incident_trace). The single source of truth shared
  by the dashboard AND the chat — so neither re-derives LogQL.
- `app/routes/loki.py` — `GET /api/loki/labels`, `/loki/labels-with-values`,
  `/loki/label/{name}/values`, `/loki/ready`, `POST /api/loki/query`, plus
  `GET /api/loki/noc/functions` (function specs) and `POST /api/loki/noc/{name}`
  (run a NOC function).
- `app/config.py` — `loki_url`, `loki_timeout`, `loki_label_window`, server settings.
- `app/main.py` — FastAPI app; `run.py` serves on `:8000`. Health: `GET /healthz`.

### `artifacts/api-server` — Express 5 backend (ESM, esbuild → `dist/index.mjs`)

Thin gateway. Two responsibilities:
- **Loki proxy** (`src/app.ts`): when `AGENTS_SERVICE_URL` is set, `/api/loki/*`
  is forwarded to the Python service (mounted before body parsers so streams pass
  through untouched).
- **CopilotKit runtime** (`src/routes/copilotkit/`): `OpenAIAdapter` + a static
  NOC-analyst persona served at `/api/copilotkit/instructions` (lists the named
  NOC function tools + when to prefer them over raw LogQL). No server-side actions
  — the agent's tools live on the frontend.
- **Pinned visuals** (`src/routes/loki-pins/` + `src/lib/loki-db.ts`): CRUD over a
  dedicated `loki` Postgres DB (auto-created). `/api/loki-pins` is NOT proxied
  (the `-` stops the Loki proxy regex match), so it's served by Express.
- **GeoIP** (`src/routes/loki-geoip/`): `POST /api/loki-geoip` batch-resolves the
  SSH attacker IPs server-side via `ip-api.com` (best-effort, cached, no key);
  degrades to `{}` if egress is blocked. Also not proxied.
- `src/routes/health.ts` (`/healthz`). Dev runner: `run-dev.mjs`.

### `artifacts/insurance-dashboard` — React 19 + Vite 7 frontend

- Routing via Wouter; `/` redirects to `/dashboard`; four pages: `/dashboard`
  (NOC/SOC dashboard), `/loki-traces` (Traces/investigation), `/loki-logs`
  (Explorer), `/loki-pins` (Pinned Visuals).
- `src/pages/LokiTraces.tsx` — the Traces view: tabs by incident_type + Live polling
  of `recent_incident_traces`; master–detail (incident list → selected
  `incident_trace`). Renders `src/components/loki/TraceWaterfall.tsx` (the Gantt/span
  waterfall) + reuses `IncidentCard` for the root-cause/recommendation block.
- `src/pages/LokiDashboard.tsx` + `src/lib/loki-dashboard.ts` — the unified NOC
  overview. `fetchNocDashboard(since)` composes the backend NOC functions (via
  `src/lib/loki-noc.ts`) in parallel into one model; the page renders the panels
  and owns the `DiagnosisDrawer` state. Per-call resilience: one failing function
  degrades its panel; it only errors if all fail.
- `src/lib/loki-noc.ts` — `callNoc(name, params)` / `listNocFunctions()` client for
  `/api/loki/noc/*` + the structured result types (mirror `app/loki/noc.py`).
- `src/components/loki/` visuals: `TimeSeriesChart`, `TopologyMap` (now a device
  category fabric), `GeoThreatMap` (d3-geo + `world-atlas` + `/api/loki-geoip`),
  `LokiChart` (Recharts), plus the **shared NOC cards** `AlarmTable`, `IncidentCard`
  (RCA/recommendation/evidence), `DeviceHealthCard`, and `DiagnosisDrawer` (the
  drill-down slide-over, with internal back-stack). Cards are reused by both the
  drawer and the chat. Dark NOC theme is global (tokens in `src/index.css`).
- `src/lib/noc-format.ts` — shared severity colours + number/time formatting.
- `src/lib/noc-actions.tsx` — `useNocCopilotActions()`: registers the chat tools
  (one CopilotKit action per NOC function + `queryLoki` fallback + `pinLokiVisual`),
  each with a structured `render`. Invoked from `CopilotPanel.tsx` so the tools
  work on every page.
- `src/pages/LokiLogs.tsx` — the Explorer (filters/pagination + page-specific
  Copilot readables only; no actions — those are global now).
- `src/pages/LokiPins.tsx` — the Pinned Visuals dashboard (per-chart Refresh + Remove).
- `src/lib/loki-api.ts` — shared `postLokiQuery` + `buildChartRows` (transform).
- `src/lib/loki-pins.tsx` — API-backed pinned-visual store (`/api/loki-pins`) with
  `refreshPin` (re-runs the stored query → rebuilds rows → saves snapshot).
- `src/components/CopilotPanel.tsx` — right-rail BI Companion chat (`<CopilotChat>`);
  calls `useNocCopilotActions()`.
- `src/lib/chat-observer.tsx` — page-observation context the chat reads.
- `src/components/layout.tsx` + `src/lib/nav-config.ts` — single-item sidebar shell.

### Libraries (`lib/`)

Mostly inert now; kept for the build graph. `lib/integrations-openai-ai-server`
(the OpenAI client for the CopilotKit runtime) is the one still imported.

### Key design notes

- **The AI chat is frontend-driven and function-grounded.** Tools are
  `useCopilotAction`s registered globally in `useNocCopilotActions()` (called from
  `CopilotPanel.tsx`); the Express runtime only provides the model + persona. The
  agent prefers the **named NOC functions** (backed by `app/loki/noc.py`) over
  hand-written LogQL — `queryLoki` is a labelled fallback. Adding a capability =
  add a function to `noc.py`, a type to `loki-noc.ts`, and an action to
  `noc-actions.tsx`.
- **LogQL building** (`buildLogQL` in `LokiLogs.tsx`): same-label values are OR'd
  via a regex alternation (`label=~"a|b"`); different labels are AND'd.
- **Pagination** is time-cursor based (Loki has no offset paging): a fixed
  `[start,end]` window is pinned at query time and each page fetches the
  next-oldest batch using the oldest line's timestamp as the next `end`.
- **Label discovery** queries Loki's label endpoints over a wide window
  (`loki_label_window`, default 30d) so every value shows up regardless of the
  smaller query range.
