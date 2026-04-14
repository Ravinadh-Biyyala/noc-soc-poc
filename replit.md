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
- **Tenant configs**:
  - `artifacts/api-server/src/config/tenants/insurance.ts` — full insurance brokerage config with data adapters
  - `artifacts/api-server/src/config/tenants/banking.ts` — commercial banking config with sample data
- **Prompt builder**: `artifacts/api-server/src/config/prompt-builder.ts` — composable system prompt from config templates
- Switch tenants: set `TENANT=banking` environment variable

### What Each Tenant Config Defines
- **Branding**: name, copilot name, industry, currency, date range
- **Sections**: id, label, route, icon, KPIs, charts, tables, widgets
- **KPIs**: label, data key, format (currency/number/percent), icon, copilot question
- **Charts**: type (bar/line/area/pie), data key, x/y keys, multi-series support
- **Tables**: columns with format, copilot question templates for click-to-ask
- **Widgets**: conditional rendering (USA map, funnel, recent items)
- **Prompt config**: persona template, domain terminology, few-shot examples, suggested prompts
- **Data sources**: static data adapters per section

### API Endpoints
- `GET /api/config` — serves active tenant config to frontend (sections, branding, prompts)
- `GET /api/dashboard/section/:sectionId` — generic config-driven data endpoint
- `GET /api/dashboard/executive|sales|products|renewals|claims|geography` — backward-compatible legacy endpoints
- OpenAI chat endpoints with SSE streaming (system prompt built from config)

### Frontend (artifacts/insurance-dashboard)
- React + Vite app with light corporate theme
- 5 dashboard views (currently hardcoded — Task #2 will make config-driven)
- USAMap component — SVG grid-based US state heat map with premium data
- **Gen-BI Copilot** chatbot panel with inline chart rendering
- Uses generated API hooks from @workspace/api-client-react
- **CopilotContext** + `useCopilot` hook for click-to-ask on KPIs, tables, charts
- **CustomDashboardsProvider** for pinning AI-generated charts to dashboard pages

### Backend (artifacts/api-server)
- Express 5 REST API with config-driven architecture
- **Prompt template engine**: composable blocks (persona, data context, chart rules, response rules, few-shot examples) interpolated from tenant config
- **Data adapter pattern**: `getDataForSection(sectionId)` and `buildDataContext()` per tenant
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
