# Gen-BI Asset

Configuration-driven multi-tenant analytics dashboard with a chat-first Copilot
that profiles your data, suggests fixes for anything that looks off, and
generates dashboards from uploaded files.

This is a pnpm monorepo with three runnable apps:

| App | What it is | Default local port |
|---|---|---|
| `@workspace/api-server` | Express REST API, AI Copilot, file ingestion | **8080** |
| `@workspace/insurance-dashboard` | The Gen-BI web UI (React + Vite) | **5173** |
| `@workspace/mockup-sandbox` | Component preview server (optional, design only) | — |

---

## Running locally

### 1. Prerequisites

- **Node.js 24** (check with `node -v`)
- **pnpm 10** — install with `npm install -g pnpm`
- **PostgreSQL 14+** running on your machine

### 2. Clone and install

```bash
git clone <your-repo-url> gen-bi-asset
cd gen-bi-asset
pnpm install
```

`pnpm install` installs every package in the monorepo in one go.

### 3. Create the database

Create a fresh Postgres database. Any name works — `genbi` is just a suggestion:

```bash
createdb genbi
```

(Or use `psql`, pgAdmin, Postico, etc. — whatever you prefer.)

### 4. Configure environment variables

Copy the template and fill in your values:

```bash
cp .env.example .env
```

Then open `.env` and set at least:

- `DATABASE_URL` — your Postgres connection string
- `SESSION_SECRET` — any long random string
- `OPENAI_API_KEY` — your OpenAI key (required for the Copilot)

`.env` is gitignored, so your secrets stay on your machine.

### 5. Push the schema to your database

```bash
pnpm db:push
```

This creates all the tables (`workspaces`, `settings`, `conversations`,
`messages`, …) using Drizzle.

### 6. Start everything

```bash
pnpm dev
```

That single command boots both the API server (port 8080) and the dashboard
(port 5173) in parallel. The Vite dev server automatically proxies `/api/*`
requests to the API, so the client keeps using relative URLs and nothing else
needs configuring.

Open **http://localhost:5173** in your browser.

### Running services individually

If you prefer separate terminals:

```bash
pnpm dev:api   # API server on http://localhost:8080
pnpm dev:web   # Dashboard  on http://localhost:5173
```

---

## Common commands

```bash
pnpm dev              # Run API + dashboard in parallel (most common)
pnpm dev:api          # API server only
pnpm dev:web          # Dashboard only
pnpm db:push          # Push schema changes to your local Postgres
pnpm typecheck        # Typecheck the whole monorepo
pnpm build            # Production build of every package
```

---

## Project layout

```
.
├── artifacts/
│   ├── api-server/           # Express API + AI Copilot
│   ├── insurance-dashboard/  # React + Vite web UI
│   └── mockup-sandbox/       # Component playground (optional)
├── lib/
│   ├── db/                   # Drizzle schema + DB client
│   ├── api-spec/             # OpenAPI contract (source of truth)
│   ├── api-zod/              # Generated Zod schemas
│   ├── api-client-react/     # Generated React Query hooks
│   └── integrations-openai-*/# Replit AI Integrations bridge
├── .env.example              # Copy → .env, then fill in
├── package.json              # Root scripts (dev, db:push, typecheck…)
└── pnpm-workspace.yaml
```

The API contract lives in `lib/api-spec`. After editing the OpenAPI spec,
regenerate the typed client + Zod validators with:

```bash
pnpm --filter @workspace/api-spec run codegen
```

---

## Troubleshooting

**`DATABASE_URL, ensure the database is provisioned`**
You haven't set `DATABASE_URL` in `.env`. See step 4.

**Dashboard loads but every API call 404s**
The API server isn't running. Open a second terminal and run `pnpm dev:api`,
or use `pnpm dev` to run both at once.

**`PORT is already in use`**
Something else on your machine is on 8080 or 5173. Stop it, or set different
ports in `.env`:

```
PORT=9090            # used by API server
API_PROXY_TARGET=http://localhost:9090
```

then run `pnpm dev:api` and `pnpm dev:web` separately.

**Copilot answers are empty / errors mention OpenAI**
`OPENAI_API_KEY` is missing or invalid. Set it in `.env` and restart `pnpm dev`.

**Schema feels out of date**
Re-run `pnpm db:push` to apply any new columns/tables to your local DB.
