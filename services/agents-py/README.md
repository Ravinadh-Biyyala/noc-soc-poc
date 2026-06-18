# Loki Logs Service (Python)

A small **FastAPI** service that fronts a Grafana **Loki** server's read API for
the "Loki Logs" dashboard tab. Self-contained over `httpx` — no database, no
LangChain/LangGraph.

When `AGENTS_SERVICE_URL` is set, the Express server proxies `/api/loki/*` here.

## Run

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python run.py        # serves on :8000
```

Configure via the repo-root `.env` (or a service-local `.env`):
- `LOKI_URL` — the Loki server (default `http://65.0.120.127:3100`)
- `LOKI_TIMEOUT` — per-request timeout seconds (default 30)
- `LOKI_LABEL_WINDOW` — lookback for label-value discovery (default `30d`)
- `AGENTS_PORT` — port (default 8000), `CORS_ORIGIN` — allowed origin

Health: `GET /healthz`.

## Endpoints (mounted under `/api`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/loki/labels` | Label names (wide window) |
| GET | `/loki/labels-with-values` | All labels → values, one fetch (powers the filter builder) |
| GET | `/loki/label/{name}/values` | Values for one label |
| GET | `/loki/ready` | Loki readiness passthrough |
| POST | `/loki/query` | Run a LogQL query (`kind` = `logs` or `metric`) |

`POST /loki/query` body: `{ logql, kind?, since?, start?, end?, limit?, step? }`.
Results are normalized: `streams` → `{ kind: "logs", rows, stats }` (JSON log
lines parsed best-effort); `matrix`/`vector` → `{ kind: "metric", series }` ready
for Recharts.

## Layout

```
app/
  main.py          # FastAPI app + lifespan + /healthz
  config.py        # pydantic-settings (loki_* + server settings)
  loki/client.py   # async Loki HTTP client + response normalization
  routes/loki.py   # the /loki/* endpoints
run.py             # uvicorn entrypoint (Windows selector loop)
```
