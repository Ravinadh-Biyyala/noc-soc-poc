# Insurance Broker Analytics Dashboard — INVEX USA

## Overview

A premium insurance broker analytics command center ("InsureBroker") themed as INVEX Insurance USA. Features 5 core dashboard sections with insurance-domain KPIs, a USA geographic heat map, and an AI "Broker Copilot" chatbot with streaming responses, thinking indicators, dashboard navigation, and dynamic dashboard creation prompts.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + Tailwind CSS + Recharts + shadcn/ui + wouter
- **Backend**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **AI Integration**: OpenAI via Replit AI Integrations (gpt-5.2)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Color Palette (Dark Theme)

- Background: Deep navy (#0a0e27) / charcoal
- Cards: Semi-transparent dark navy (#1a1f3a) with thin borders (#2a3055)
- Sidebar: Very dark navy (#070b1e)
- Primary accent: Muted teal (#14b8a6) for positive growth
- Destructive: Burnt orange/amber (#f59e0b) for risk/warnings
- Charts: Teal, Sky blue, Indigo, Amber, Rose
- Text: White (#f8fafc) headers, Soft gray (#94a3b8) secondary

## Architecture

### Frontend (artifacts/insurance-dashboard)
- React + Vite app with dark navy theme
- 5 dashboard views with insurance broker terminology
- USAMap component — SVG grid-based US state heat map with premium data
- Broker Copilot chatbot panel with SSE streaming, thinking indicators, navigation buttons, and dynamic dashboard creation UI
- Uses generated API hooks from @workspace/api-client-react

### Backend (artifacts/api-server)
- Express 5 REST API
- Dashboard data endpoints: /api/dashboard/executive, /sales, /products, /renewals, /claims, /geography
- OpenAI chat endpoints with SSE streaming and insurance-contextual system prompt
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

1. **Executive Summary** (`/`) — Written Premium ($187.4M), Commission Revenue, Policies Bound, Renewal Rate, Quote-to-Bind, YoY Growth, Premium & Commission Trends chart, Policy Mix donut, USA Geographic Heat Map, Top States by Premium
2. **Sales Performance** (`/sales`) — Quote Rate, Bind Rate, Closing Ratio, Avg Days to Bind, Sales Pipeline funnel, Monthly Bind Trend, Producer Leaderboard table, Account Size Distribution
3. **Product Analytics** (`/products`) — Premium by Line of Business stacked area chart, Lines of Business performance table (Commercial Property, GL, Commercial Auto, Workers Comp, Cyber, Professional Liability), Carrier Performance table (Hartford, Travelers, Chubb, etc.)
4. **Renewals & Retention** (`/renewals`) — Renewal Rate, Retention Ratio, Retained vs Lost Premium, Premium at Risk (30/60/90d), Retention Trend chart, Churn by Producer table
5. **Claims & Risk** (`/claims`) — Loss Ratio, Open/Closed Claims, Claim Frequency, Avg Incurred Loss, Severity, Incurred Loss by LOB bar chart, Top States by Risk, Recent Claims Activity table with status badges

## AI Broker Copilot Features
- Streaming AI responses via Server-Sent Events
- "Analyzing data..." thinking indicator with spinning animation
- Context-aware with full brokerage data (2023 vs 2022 YoY)
- Dashboard navigation via [NAVIGATE:/route] parsed as "View Dashboard" buttons
- Dynamic dashboard creation via [CREATE_DASHBOARD:title] with Yes/No confirmation cards
- Bold text markdown (**text**) rendering in messages
- Conversation persistence in PostgreSQL
- New chat creation via + button

## Data Context (2023 vs 2022)
- Written Premium: $187.4M (+11.4% YoY)
- Commission Revenue: $28.1M
- Policies Bound: 8,234 (+10.4% YoY)
- Renewal Rate: 91.2%
- Quote-to-Bind: 34.2%
- Retention Ratio: 93.4%
- Loss Ratio: 48.7%
- Active in 42 US states
- Top States: CA, TX, NY, FL, IL
- Top Producer: Sarah Mitchell ($32.4M)
- Fastest Growing Line: Cyber (+33.9%)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
