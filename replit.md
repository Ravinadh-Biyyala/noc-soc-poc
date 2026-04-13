# Insurance Broker Analytics Dashboard — INVEX USA

## Overview

A premium insurance broker analytics command center ("InsureBroker") themed as INVEX Insurance USA. Features 5 core dashboard sections with insurance-domain KPIs, a USA geographic heat map, and a **Gen-BI (Generative Business Intelligence)** AI Broker Copilot that generates inline data visualizations (bar, line, area, pie charts) in response to any data question.

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

## Architecture

### Frontend (artifacts/insurance-dashboard)
- React + Vite app with light corporate theme
- 5 dashboard views with insurance broker terminology
- USAMap component — SVG grid-based US state heat map with premium data
- **Gen-BI Broker Copilot** chatbot panel:
  - Inline chart rendering (Recharts) inside chat bubbles
  - Supports bar, line, area, pie charts
  - Custom bracket-based parser for `[CHART:{...}]` blocks
  - SSE streaming with thinking indicators
  - Navigation buttons and dashboard creation prompts
  - Quick-start suggestion buttons
- Uses generated API hooks from @workspace/api-client-react

### Backend (artifacts/api-server)
- Express 5 REST API
- Dashboard data endpoints: /api/dashboard/executive, /sales, /products, /renewals, /claims, /geography
- OpenAI chat endpoints with SSE streaming
- **Rich data context** injected into system prompt: yearly performance, state monthly data, producer monthly data, line monthly data, carrier data, claims, renewals
- Data covers **2022-2026** (Jan 2022 — Apr 2026)
- PostgreSQL for conversation/message persistence
- Data files in src/routes/dashboard/data/ — modular per section

### Database Tables
- `conversations` — AI chat conversations
- `messages` — Chat messages (user and assistant)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Dashboard Pages

1. **Executive Summary** (`/`) — Written Premium ($267.8M), Commission Revenue ($40.2M), Policies Bound (11,482), Renewal Rate (92.8%), Quote-to-Bind (37.2%), YoY Growth (+10.1%), Premium & Commission Trends (2022-2026), Policy Mix donut, USA Geographic Heat Map, Top States
2. **Sales Performance** (`/sales`) — Quote Rate (71.2%), Bind Rate (37.2%), Closing Ratio (26.4%), Avg Days to Bind (15.8), Sales Pipeline funnel, Monthly Bind Trend, Producer Leaderboard
3. **Product Analytics** (`/products`) — Premium by Line of Business stacked area, Lines of Business table, Carrier Performance table
4. **Renewals & Retention** (`/renewals`) — Renewal Rate (92.8%), Retained Premium ($175.8M), Lost Premium ($9.6M), Premium at Risk, Retention Trend, Churn by Producer
5. **Claims & Risk** (`/claims`) — Loss Ratio (46.2%), Open Claims (412), Incurred Loss by LOB, Top States by Risk, Recent Claims (2026 dates)

## Gen-BI Broker Copilot Features
- **Generative BI**: Every data question generates an inline chart visualization
- Chart types: bar (comparisons), line/area (trends), pie (composition)
- Inline Recharts rendering inside chat bubbles
- Custom JSON parser for `[CHART:{...}]` format with brace-depth matching
- Streaming AI responses via Server-Sent Events
- "Generating insights..." thinking indicator with spinning animation
- Full data context: 2022-2026 yearly, monthly state/producer/line breakdowns
- Dashboard navigation via `[NAVIGATE:/route]` buttons
- Dynamic dashboard creation via `[CREATE_DASHBOARD:title]` with Yes/No cards
- Bold markdown rendering
- Quick-start suggestion buttons
- Conversation persistence in PostgreSQL

## Data Context (2025 vs 2024, Data Range: 2022-2026)
- Written Premium: $267.8M (+10.1% YoY)
- Commission Revenue: $40.2M
- Policies Bound: 11,482 (+10.2% YoY)
- Renewal Rate: 92.8%
- Quote-to-Bind: 37.2%
- Retention Ratio: 94.8%
- Loss Ratio: 46.2%
- Active in 45 US states
- Top States: CA ($48.8M), TX ($41.2M), NY ($33.6M), FL ($28.9M), IL ($20.4M)
- Top Producer: Sarah Mitchell ($46.2M)
- Fastest Growing Line: Cyber (+34.7%)
- Top Carrier: Hartford Financial ($60.2M placed)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
