# Insurance Broker Analytics Dashboard

## Overview

A comprehensive insurance broker analytics dashboard with multiple dashboard views, AI-powered chatbot, and real-time data visualization. Built as a pnpm monorepo with React + Vite frontend and Express backend.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + Tailwind CSS + Recharts + shadcn/ui
- **Backend**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **AI Integration**: OpenAI via Replit AI Integrations (gpt-5.2)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Architecture

### Frontend (artifacts/insurance-dashboard)
- React + Vite app with Tailwind CSS styling
- 8 dashboard views: Overview, Claims, Policies, Predictive, Sentiment, EDA, Brokers, Revenue
- AI chatbot panel with streaming responses via SSE
- Uses generated API hooks from @workspace/api-client-react
- Recharts for data visualization

### Backend (artifacts/api-server)
- Express 5 REST API
- Dashboard data endpoints serving insurance analytics data
- OpenAI chat endpoints with SSE streaming
- PostgreSQL for conversation/message persistence
- Routes: /api/dashboard/*, /api/openai/*

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

1. **Overview** (`/`) — KPIs, premium trends, claims trends, policy distribution
2. **Claims Analysis** (`/claims`) — Claims by type/status/severity, recent claims table
3. **Policy Analytics** (`/policies`) — Policy distribution, premium analysis, renewal rates
4. **Predictive Insights** (`/predictive`) — Churn prediction, risk scoring, forecasts
5. **Sentiment** (`/sentiment`) — NPS, feedback analysis, sentiment by channel
6. **Data Explorer** (`/eda`) — Correlations, distributions, outliers, feature importance
7. **Broker Teams** (`/brokers`) — Broker leaderboard, conversion rates, regional performance
8. **Revenue** (`/revenue`) — Revenue trends, commissions, revenue drivers

## AI Chatbot Features
- Streaming AI responses via Server-Sent Events
- Context-aware insurance analytics assistant
- Dashboard navigation suggestions via [NAVIGATE:/route] markers
- Conversation history persistence in PostgreSQL

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
