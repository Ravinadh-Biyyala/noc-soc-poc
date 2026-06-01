# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start everything (API on :8080, dashboard on :5173)
pnpm dev

# Individual services
pnpm dev:api          # API server only
pnpm dev:web          # Frontend only

# Python agent service (FastAPI + LangChain/LangGraph) on :8000
cd services/agents-py && python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt && .venv/Scripts/python run.py
# Then set AGENTS_SERVICE_URL=http://localhost:8000 in .env so Express proxies the agent routes to it.

# Production build (runs typecheck + all packages)
pnpm build

# Type checking
pnpm typecheck
pnpm typecheck:libs   # lib packages only

# Database schema sync
pnpm db:push

# Regenerate Zod validators + React Query hooks from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen
```

No test suite exists in this codebase.

## Environment Variables

Copy `.env.example` to `.env`. Required:
- `DATABASE_URL` — PostgreSQL connection string
- `SESSION_SECRET` — Random string for session signing
- `OPENAI_API_KEY` — OpenAI key (gpt-4.1-mini)

Optional:
- `TENANT` — Active tenant config (`insurance` or `banking`, default: `insurance`)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `REDIRECT_URI` — Google OAuth
- `PORT` — API port (default: `8080`)
- `API_PROXY_TARGET` — Frontend's proxy target (default: `http://localhost:8080`)

Run `pnpm db:push` after setting `DATABASE_URL` to initialize the schema.

## Architecture

**pnpm monorepo** with two deployable apps and several shared libraries, plus a
standalone Python agent service (`services/agents-py`).

### Python agent service (`services/agents-py`)

A FastAPI service that re-implements the AI agent layer on **LangChain +
LangGraph**, with **LangSmith** tracing into the `genbi-agents` project. Each
agent is a compiled LangGraph `StateGraph` (LLM ↔ `ToolNode` loop) on the shared
`AsyncPostgresSaver` checkpointer; `agents/pipeline/graph.py` chains the phases
with `interrupt()` for human-in-the-loop. It hits the **same Postgres** and the
same `project_*` / dashboard tables, so the frontend contract is preserved. When
`AGENTS_SERVICE_URL` is set, Express proxies the agent vertical
(`/api/projects/:id/(agents|transformations|semantic-model|relationships|metrics|warehouse-tables|dashboards|pipeline)`)
to it; unset to fall back to the TS routers in `artifacts/api-server/src/agents`.
See `services/agents-py/README.md`. The TS agent code remains as the fallback.



### Apps

**`artifacts/api-server`** — Express 5 backend (ESM, bundled via esbuild to `dist/index.mjs`).
- Routes live in `src/routes/`, all exposed under `/api/*`
- AI agents in `src/agents/` (data-engineer, data-modeler, metric-architect, analyst-chat)
- Tenant config in `src/config/tenants/` (selected by `TENANT` env var)
- Dev runner is `run-dev.mjs`, which loads `.env`, builds, then starts the server

**`artifacts/insurance-dashboard`** — React 19 + Vite 7 frontend.
- Routing via Wouter; pages in `src/pages/`
- API calls via generated React Query hooks (`@workspace/api-client-react`)
- Dev server proxies `/api/*` to `:8080`

### Libraries

| Package | Purpose |
|---|---|
| `lib/db` | Drizzle ORM schema + PostgreSQL client |
| `lib/api-spec` | OpenAPI spec — source of truth for the API contract |
| `lib/api-zod` | **Generated** Zod validators (do not edit manually) |
| `lib/api-client-react` | **Generated** React Query hooks (do not edit manually) |
| `lib/integrations-openai-ai-server` | Server-side OpenAI wrapper |
| `lib/integrations-openai-ai-react` | Client-side OpenAI utilities |

### Key Design Patterns

**Configuration-driven UI.** Tenant configs (`src/config/tenants/*.ts`) declare sections, KPI cards, charts, and data adapters. The frontend reads this via `TenantConfigProvider` and renders generically — adding a new dashboard section means editing config, not components.

**OpenAPI → codegen pipeline.** The OpenAPI spec in `lib/api-spec` is the single source of truth. After spec changes, run `pnpm --filter @workspace/api-spec run codegen` to regenerate `lib/api-zod` and `lib/api-client-react`. Never edit generated files directly.

**Three-phase AI pipeline with human-in-the-loop.**
1. **Data Engineer** — profiles raw uploaded tables, proposes transformations
2. **Data Modeler** — builds a semantic model from transformed data (no DDL, proposes joins/dimensions/measures)
3. **Metric Architect** — defines SQL-based metrics against the semantic model

Each phase returns proposals; the user approves before the next phase runs. Agent state is persisted via LangGraph checkpoints to the `pipeline_checkpoints` table so sessions survive HTTP request boundaries. Agents stream responses via Server-Sent Events.

**Agent anatomy.** Each agent directory contains:
- `system-prompt.ts` — assembles the prompt from composable blocks
- `tools.ts` — OpenAI tool definitions
- `executor.ts` — orchestration logic

Shared infrastructure: `src/agents/graph/graph.ts` (LangGraph state machine), `src/agents/shared/runner.ts` (SSE streaming handler), `src/agents/shared/blocks.ts` (reusable prompt fragments).

### Database Schema

Drizzle schema files are in `lib/db/src/schema/`. Key tables: `workspaces`, `conversations`, `messages`, `datasets`, `project_transformations`, `project_semantic_models`, `project_metrics`, `copilot_dashboards`, `user_dashboards`, `settings`, `google_users`, `pipeline_checkpoints`. Apply changes with `pnpm db:push` (no migration files — schema-push only).

### Frontend State

| Context | Responsibility |
|---|---|
| `TenantConfigProvider` | Loads tenant config once; all pages read from it |
| `CopilotProvider` | Active workspace + conversation state for the Copilot |
| `CustomDashboardsProvider` | User-created dashboards |
| `GeneratedDashboardProvider` | AI-generated dashboards |
| `ChatObserverProvider` | Tracks chat state for context-aware suggestions |

### Path Aliases

Frontend uses `@/*` → `src/*`. All packages use `@workspace/*` workspace aliases (e.g. `@workspace/db`, `@workspace/api-client-react`).
