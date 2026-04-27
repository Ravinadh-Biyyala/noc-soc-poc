# Gen-BI Asset — Enterprise Analytics Dashboard

## Overview

An enterprise-grade, **configuration-driven** analytics dashboard platform. Features a multi-tenant architecture where switching between industries (insurance, banking, utilities) requires only changing a configuration file — not code. Ships with two complete tenant configs: **Insurance Brokerage** (default) and **Commercial Banking** (sample). Includes a Gen-BI AI Copilot that generates inline data visualizations.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + Tailwind CSS + Recharts + shadcn/ui + wouter
- **Backend**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **AI Integration**: OpenAI via Replit AI Integrations (gpt-4.1-mini)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Color Palette (Light Theme — McKinsey-inspired)

- Background: Light gray (#f5f7fa)
- Cards: White (#ffffff) with subtle shadows and borders (#e1e5eb)
- Sidebar: Dark navy (#1a2332) — kept dark for contrast
- Primary accent: Deep blue (#1565C0) for primary interactions
- Charts: Deep blue, electric blue, teal, cyan palette
- USA Map: Blue-to-teal gradient by premium volume
- Risk/Alerts: Red (#ef4444) for warnings
- Positive: Emerald (#10b981) for growth indicators
- Text: Dark (#1e293b) on white, light on dark sidebar

## Enterprise Architecture

### Configuration-Driven Tenant System
- **Config schema**: `artifacts/api-server/src/config/types.ts` — TypeScript types for `TenantConfig`
- **Config loader**: `artifacts/api-server/src/config/index.ts` — reads `TENANT` env var (default: `insurance`)
- **Data adapter**: `artifacts/api-server/src/config/data-adapter.ts` — `DataAdapter` interface + `StaticDataAdapter` implementation
- **Tenant configs**:
  - `artifacts/api-server/src/config/tenants/insurance.ts` — full insurance brokerage config with data adapters
  - `artifacts/api-server/src/config/tenants/banking.ts` — commercial banking config with sample data
- **Prompt builder**: `artifacts/api-server/src/config/prompt-builder.ts` — composable system prompt from config templates
- Switch tenants: set `TENANT=banking` environment variable

### What Each Tenant Config Defines
- **Branding**: name, copilot name, industry, currency, date range
- **Sections**: id, label, route, icon, KPIs, charts, tables, widgets
- **KPIs**: label, data key, format (currency/number/percent), icon, copilot question, changeKey for YoY
- **Charts**: type (bar/line/area/pie), data key, x/y keys, multi-series support
- **Tables**: columns with format, copilot question templates for click-to-ask
- **Widgets**: conditional rendering (USA map, funnel, recent items)
- **Prompt config**: persona template, domain terminology, few-shot examples, suggested prompts
- **Data sources**: static data adapters per section via `DataAdapter` interface

### API Endpoints
- `GET /api/config` — serves active tenant config to frontend (sections, branding, prompts)
- `GET /api/dashboard/:sectionId` — unified config-driven data endpoint
- `GET /api/dashboard/executive|sales|products|renewals|claims|geography` — backward-compatible legacy endpoints
- OpenAI chat endpoints with SSE streaming (system prompt built from config)

### Frontend (artifacts/insurance-dashboard) — Config-Driven
- React + Vite app with light corporate theme
- **TenantConfigProvider** (`src/lib/tenant-config.tsx`) — fetches `/api/config` on load, provides config via React context
- **Icon resolver** — maps icon name strings from config to Lucide icon components
- **DashboardSection** (`src/components/DashboardSection.tsx`) — single generic page component that reads section config and renders KPIs, charts, tables, and widgets dynamically
  - `ConfigKPICard` — renders primary (with YoY change) or secondary KPI cards from config
  - `ConfigChart` — renders area/bar/line/pie charts from config (supports stacked multi-series)
  - `ConfigTable` — renders data tables with click-to-ask copilot integration
- **Config-driven routing** — `App.tsx` generates `<Route>` components from config sections array
- **Config-driven navigation** — sidebar nav items rendered from config sections (labels, icons, routes)
- **Config-driven Copilot** — copilot name, suggested prompts, and click-to-ask templates from config
- USAMap component conditionally rendered only when config declares a `usa-map` widget
- Old hardcoded page files (dashboard.tsx, sales.tsx, etc.) removed — single DashboardSection replaces all
- Uses generated API hooks from @workspace/api-client-react (`useGetTenantConfig`, `useGetDashboardSection`)
- **CopilotContext** + `useCopilot` hook for click-to-ask on KPIs, tables, charts
- **CustomDashboardsProvider** for pinning AI-generated charts to dashboard pages

### Backend (artifacts/api-server)
- Express 5 REST API with config-driven architecture
- **Prompt template engine**: composable blocks (persona, data context, chart rules, response rules, few-shot examples) interpolated from tenant config
- **DataAdapter interface**: async `getDataForSection(sectionId)` and `getFullDataContext()` per tenant
- PostgreSQL for conversation/message persistence

### Database Tables
- `conversations` — AI chat conversations
- `messages` — Chat messages (user and assistant)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Dashboard Pages (Insurance Tenant — Default)

1. **Executive Summary** (`/`) — Written Premium ($267.8M), Commission Revenue ($40.2M), Policies Bound (11,482), Renewal Rate (92.8%), Quote-to-Bind (37.2%), YoY Growth (+10.1%), Premium & Commission Trends (2022-2026), Policy Mix donut, USA Geographic Heat Map, Top States
2. **Sales Performance** (`/sales`) — Quote Rate (71.2%), Bind Rate (37.2%), Closing Ratio (26.4%), Avg Days to Bind (15.8), Sales Pipeline funnel, Monthly Bind Trend, Producer Leaderboard
3. **Product Analytics** (`/products`) — Premium by Line of Business stacked area, Lines of Business table, Carrier Performance table
4. **Renewals & Retention** (`/renewals`) — Renewal Rate (92.8%), Retained Premium ($175.8M), Lost Premium ($9.6M), Premium at Risk, Retention Trend, Churn by Producer
5. **Claims & Risk** (`/claims`) — Loss Ratio (46.2%), Open Claims (412), Incurred Loss by LOB, Top States by Risk, Recent Claims (2026 dates)

## Banking Tenant (Sample)

1. **Loan Portfolio Overview** (`/`) — Total Assets ($4.25B), NII ($186.5M), Total Loans ($3.12B), NIM (4.38%), ROE (12.45%), NPL Ratio (1.34%), Tier 1 Capital (12.8%)
2. **Revenue Analytics** (`/revenue`) — Revenue breakdown, RM Leaderboard, Revenue by Segment
3. **Customer Segments** (`/customers`) — Customer base (248K), Retention (91.2%), Digital Adoption (78.4%), NPS (62)
4. **Risk & Compliance** (`/risk`) — NPL by Segment, Capital Trends, Charge-Off Rate
5. **Branch Performance** (`/branches`) — 124 branches, Digital Transactions (68.2%), Performance by Region

## Data Ingestion & Auto-Dashboard Generation
- **Upload page** (`/upload`): Drag-and-drop CSV/XLSX/XLS files; supports adding multiple files
- **Backend parsing** (`POST /api/upload`): multer + xlsx, multi-sheet support, returns full row data + column metadata
- **AI dashboard generation** (`POST /api/generate-dashboard`): gpt-4.1-mini with `json_object` response_format; uses up to 150 rows of actual prepared data in prompt
- **10+ visualization types**: area, bar, horizontal-bar, line, pie, donut, scatter, bubble, radar, treemap, stacked-area, stacked-bar, gauge, waterfall, heatmap, progress-bar

### Tableau-like Data Prep (`components/DataPrep.tsx`)
- **Multi-file workflow**: upload several CSV/XLSX files, each becomes a "source table"
- **Operations pipeline** (all client-side via `lib/data-operations.ts`):
  - **Joins**: inner / left / right / outer on selected key columns; safe key handling for nulls/types/delimiters
  - **Filters**: equals, not equals, >, <, ≥, ≤, contains, not contains, in (csv list), is null, is not null
  - **Aggregations**: group by multiple columns + sum/avg/count/count_distinct/min/max/first
  - **Calculated columns**: JavaScript expressions over column names (e.g. `Revenue - Cost`)
- **Cascade delete**: removing an upstream operation also removes downstream ops referencing it
- **Live preview**: data grid updates in real time as ops are added; shows row/column counts per stage
- **Tables panel**: tree view of source tables and derived tables with column type indicators
- **Suggested joins** (heuristic, no AI): `suggestJoins()` in `data-operations.ts` scores cross-table column pairs by name similarity (normalized Jaccard + suffix-id match) plus value overlap (300-row sample), surfacing top suggestions in an amber banner above the pipeline. One-click "Apply" creates an inner join; "Customize" pre-fills the Join modal via the `seedJoin` prop. Suggestions are filtered by exact key tuple (table+column on both sides) so alternate joins remain visible. Dismiss state resets when source tables change.
- **Sample dataset**: `public/samples/{orders,customers,products}.csv` ships with the app. Empty upload page shows a "No data handy?" card with per-file Load + Download buttons and a "Load all 3" button — designed to demo joins on CustomerID and ProductID.
- After preparing, "Generate Dashboard" sends the final transformed table to AI for visualization

### Generated Dashboard Persistence
- **GeneratedDashboardProvider** (`src/lib/generated-dashboards.tsx`): persists generated dashboards in localStorage (`genbi-generated-dashboards`), provides `useGeneratedDashboards` hook
- **Dynamic routing**: generated dashboards get unique routes (`/generated/<slug>-<id>`) and appear in sidebar under "Your Data" section
- **Sidebar integration**: "Upload Data" button + generated dashboard links with delete option
- Key files: `UploadPage.tsx`, `DataPrep.tsx`, `data-operations.ts`, `GeneratedDashboard.tsx`, `generated-dashboards.tsx`, `api-server/src/routes/upload/index.ts`

## Gen-BI Copilot Features
- **Generative BI**: Every data question generates an inline chart visualization
- Chart types: bar (comparisons), line/area (trends), pie (composition)
- Inline Recharts rendering inside chat bubbles
- Custom JSON parser for `[CHART:{...}]` format with brace-depth matching
- Streaming AI responses via Server-Sent Events
- "Generating insights..." thinking indicator with spinning animation
- Full data context injected from tenant config
- Dashboard navigation via `[NAVIGATE:/route]` buttons
- Dynamic dashboard creation via `[CREATE_DASHBOARD:title]`
- Bold markdown rendering
- Quick-start suggestion buttons
- Conversation persistence in PostgreSQL
- **Config-driven**: persona, terminology, few-shot examples, suggested prompts all from tenant config

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
