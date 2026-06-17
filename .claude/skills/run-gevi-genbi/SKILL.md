---
name: run-gevi-genbi
description: run, start, launch, screenshot, verify, test the Gen VI / GenBI insurance dashboard app. Use when asked to run the app, confirm a feature works, take a screenshot, or check a UI change.
---

# Run Gen VI — GenBI Insurance Dashboard

This is a **pnpm monorepo** web app with two servers that must both be running:

- **Express API** (`artifacts/api-server`) → `http://localhost:8080`
- **Vite React frontend** (`artifacts/insurance-dashboard`) → `http://localhost:5173`

The driver is `chromium-cli` (Playwright MCP). No custom driver file needed — use the inline commands below.

---

## Prerequisites

- Node ≥ 20 (verified on v24.15.0)
- pnpm ≥ 9 (verified on 11.1.2)
- PostgreSQL running with a `genbi` database
- `.env` at repo root with `DATABASE_URL`, `SESSION_SECRET`, and `OPENAI_API_KEY` filled in

```bash
# Confirm both runtimes are present
node --version   # v24.15.0
pnpm --version   # 11.1.2
```

If `pnpm` is not installed: `npm install -g pnpm`

---

## Start the App

Run both servers in parallel (the `--parallel` flag is already in the root `dev` script):

```bash
# From repo root — starts both API (:8080) and Vite (:5173)
pnpm dev
```

Or start each separately (useful in two terminals, or as background processes):

```bash
pnpm dev:api   # Express on :8080 — takes ~5s to build and boot
pnpm dev:web   # Vite on :5173 — ready in ~2s
```

**On Windows** — to start as detached background processes:

```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; pnpm dev:api" -WindowStyle Minimized
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; pnpm dev:web" -WindowStyle Minimized
```

**Health check (API):**

```bash
curl http://localhost:8080/api/workspaces
# Returns JSON array of projects. 200 = API is up.
# NOTE: GET / and GET /api/projects return 404 — use /api/workspaces
```

**Health check (frontend):**

```bash
curl -s http://localhost:5173 | head -5
# Returns HTML with <title>Insurance Broker Dashboard</title>
```

---

## Agent Path — Drive with chromium-cli / Playwright

Navigate to the app and take screenshots:

```
# Navigate to home page
browser_navigate: http://localhost:5173

# Take a screenshot
browser_take_screenshot

# Navigate to Projects page
browser_navigate: http://localhost:5173/projects

# Navigate to Dashboards page
browser_navigate: http://localhost:5173/dashboards
```

**Verified routes (all return 200 and render correctly):**

| Route | What you see |
|---|---|
| `http://localhost:5173/` | Home — "Hi, I'm Gen-BI" + data source prompt + BI Companion panel |
| `http://localhost:5173/projects` | Project grid with real DB records (Hilton, jdcj, etc.) |
| `http://localhost:5173/dashboards` | Auto-generated dashboard cards ("READY" status) |
| `http://localhost:5173/reports` | Salesforce DCR reports tab |
| `http://localhost:5173/settings` | Settings page |

**Interact with BI Companion chat (right panel):**

```
# Type a message in the chat input
browser_fill: [placeholder="Ask anything about your data..."], "Show me the projects"
browser_press_key: Enter
browser_take_screenshot
```

---

## Human Path

```bash
pnpm dev
# Opens nothing — visit http://localhost:5173 in a browser
# Ctrl-C to stop both servers
```

---

## Direct API Invocation (for PRs that touch backend routes)

```bash
# List all workspaces/projects
curl http://localhost:8080/api/workspaces

# Get a specific project (replace 16 with a real project id)
curl http://localhost:8080/api/workspaces/16

# Agent pipeline routes (SSE streams — need EventSource client)
# POST /api/projects/:id/agents/data-engineer/start
# POST /api/projects/:id/agents/data-modeler/start
# POST /api/projects/:id/agents/metric-architect/start
```

---

## Gotchas

- **API root 404**: `GET /` and `GET /api/projects` return 404. The correct health-check route is `GET /api/workspaces`.
- **Vite ready before API**: `pnpm dev:web` starts in ~2s; `pnpm dev:api` takes ~5–8s to esbuild-compile and connect to Postgres. If screenshots show no data, wait for the API. Check with the curl above.
- **Session auto-initialised**: No login screen. The app uses a session cookie seeded from `SESSION_SECRET` — if you see an auth redirect, clear cookies and reload.
- **Python agent service is optional**: The `AGENTS_SERVICE_URL=http://localhost:8000` proxy to FastAPI is only needed for LangGraph agent flows. The Express fallback TS agents work without it. Skip the Python service unless testing auto-mode dashboards.
- **Windows background processes**: `Start-Process powershell -WindowStyle Minimized` works. Using `&` in PowerShell does NOT detach properly for long-running servers.
- **BI Companion panel**: Uses `@copilotkit/react-core`. It needs `OPENAI_API_KEY` set in `.env` to respond. Without it, the chat input accepts text but the server returns a 500.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot GET /api/projects` | Use `/api/workspaces` instead |
| API returns 500 on chat routes | Set `OPENAI_API_KEY` in `.env` |
| `Error: connect ECONNREFUSED 127.0.0.1:5432` | PostgreSQL is not running; start it with `pg_ctl start` or the Windows service |
| Vite shows blank page with console errors | API is not yet up; wait 5–10 seconds and reload |
| `pnpm: command not found` | `npm install -g pnpm` |
| Dashboard cards show "0 tables · 0 rows" | Normal for draft projects with no uploaded data — the UI is correct |
