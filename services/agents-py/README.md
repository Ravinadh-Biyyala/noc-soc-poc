# Gen-BI Agents (Python)

A FastAPI service that re-implements the Express AI agent layer on **LangChain +
LangGraph**, with **LangSmith** tracing into the `genbi-agents` project. It owns
the AI agent vertical; the Express server keeps auth, upload, ingest, datasets,
workspaces, settings, and the copilot.

It connects to the **same Postgres** as Express (`DATABASE_URL`) and reads/writes
the same `project_transformations` / `project_semantic_models` / `project_metrics`
/ `user_dashboards` / `dashboard_charts` tables, so the frontend contract is
unchanged.

## Agents

Each agent is a compiled LangGraph `StateGraph` (an LLM `agent` node ↔ `ToolNode`
loop) using the shared `AsyncPostgresSaver` checkpointer.

| Agent | Phase | Tools |
|---|---|---|
| Data Engineer | Bronze→Silver | `get_schema_info`, `profile_data`, `propose_cleaning`, `execute_transformation` |
| Data Modeler (semantic) | Silver→Semantic | `list_warehouse_tables`, `propose_star_schema`, `generate_semantic_graph` |
| Data Modeler (dashboard) | consumption | `list_warehouse_tables`, `execute_warehouse_query`, `create_dashboard` |
| Metric Architect | Gold KPIs | `read_semantic_model`, `list_warehouse_tables`, `suggest_metrics`, `save_measure_metadata` |
| Analyst Chat | Q&A (SSE stream) | `execute_warehouse_query` (read-only) |

`agents/pipeline/graph.py` chains the three proposal phases with `interrupt()`
for human-in-the-loop approval (the orchestrated alternative to the discrete
`/suggest` + `/accept` endpoints).

## Layout

```
app/
  main.py            FastAPI app + lifespan (pool, checkpointer, tracing)
  config.py          settings (root .env + service .env override)
  tracing.py         LangSmith env wiring
  llm/client.py      ChatOpenAI factory (AI_INTEGRATIONS_OPENAI_*)
  checkpoint/saver.py AsyncPostgresSaver
  db/                psycopg3 pool, schema helpers, repositories, introspection
  agents/
    shared/          prompts, validation, react graph builder, run helper, serde
    data_engineer/ data_modeler/ metric_architect/ analyst_chat/ pipeline/
  routes/            transformations, modeling, metrics, agents, pipeline
```

## Run

```bash
cd services/agents-py
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # (POSIX: .venv/bin/python)
.venv/Scripts/python run.py                               # serves on :8000
```

`run.py` sets the Windows Selector event loop (psycopg async requirement) and
starts uvicorn. Verify: `curl http://localhost:8000/healthz` →
`{"status":"ok","project":"genbi-agents"}`.

## Wire Express to it

Set `AGENTS_SERVICE_URL=http://localhost:8000` in the repo-root `.env` and restart
the Express server. Express then proxies the agent vertical to this service. Unset
it to fall back to the original TS routers (zero behavioural change).

## Endpoints (under `/api`, same paths as Express)

- `POST /projects/{id}/agents/data-engineer/suggest`, `GET /projects/{id}/transformations`,
  `POST .../transformations/{tid}/accept|reject`, `DELETE .../transformations/{tid}`
- `GET /projects/{id}/warehouse-tables`,
  `POST /projects/{id}/agents/data-modeler/suggest` (+ `suggest-relationships`),
  semantic-model CRUD, `GET /projects/{id}/relationships`,
  `POST /projects/{id}/agents/data-modeler/generate-dashboard`, dashboards list/get/delete
- `POST /projects/{id}/agents/metric-architect/suggest`, metrics CRUD (+ `PATCH`)
- `GET /projects/{id}/agents/{agent}/preview-prompt`
- `POST /projects/{id}/agents/analyst-chat/messages` (SSE)
- `POST /projects/{id}/pipeline/start|resume`, `GET /projects/{id}/pipeline/state`

## Tracing

Traces land in the LangSmith project named by `LANGSMITH_PROJECT` (defaults to
`genbi-agents` via `services/agents-py/.env`). No per-call code — LangChain emits
spans automatically once the `LANGSMITH_*` env vars are set.
