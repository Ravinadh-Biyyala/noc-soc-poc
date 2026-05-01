# Gen-BI Asset — Enterprise Analytics Dashboard

## Overview

This project is an enterprise-grade, configuration-driven analytics dashboard platform designed for multi-tenant environments. Its primary purpose is to provide flexible, industry-specific data visualization and analysis capabilities, with a focus on ease of configuration rather than code modification for different business domains. A key feature is the integrated Gen-BI AI Copilot, which generates inline data visualizations based on user queries. The platform aims to offer a comprehensive, adaptable solution for business intelligence, initially targeting the insurance brokerage and commercial banking sectors.

## User Preferences

I want iterative development.
I prefer to be asked before making major changes.
I like clear and concise explanations.

## System Architecture

The system is built as a monorepo using pnpm workspaces, with Node.js 24 and TypeScript 5.9.

**Core Architectural Pattern:** Configuration-Driven Multi-Tenancy.
The platform's core design revolves around a configuration-driven approach, enabling adaptation to different industries (tenants) by simply changing a configuration file. This is managed by a `TenantConfig` schema and loader, which dynamically adjusts branding, sections, KPIs, charts, tables, widgets, and AI prompt configurations based on the active tenant.

**Frontend (React + Vite):**
- Uses Tailwind CSS, Recharts, shadcn/ui, and wouter for UI and routing.
- Employs a light, corporate theme inspired by McKinsey's aesthetic (light gray background, white cards, dark navy sidebar, deep blue accents).
- `TenantConfigProvider` fetches and manages the active tenant configuration, dynamically rendering dashboard sections, navigation, and the AI Copilot interface.
- A single `DashboardSection` component dynamically renders content based on the fetched configuration, eliminating the need for hardcoded pages.
- Dynamic routing and navigation are generated from the tenant configuration.
- The UI includes components for KPIs, various chart types (area, bar, line, pie), data tables with Copilot integration, and conditional widgets like a USA map.

**Backend (Express 5):**
- Provides REST APIs for serving tenant configurations and dashboard data.
- Employs a `DataAdapter` interface for fetching section-specific and full data contexts based on the tenant.
- A prompt template engine constructs AI system prompts using composable blocks derived from tenant configuration.
- API codegen is handled by Orval from an OpenAPI spec, generating Zod schemas and TypeScript interfaces.

**Database:**
- PostgreSQL is used with Drizzle ORM for data persistence.
- Key tables include `conversations`, `messages` (for AI chat), `workspaces` (for analytics projects), and `settings` (for user preferences — organization, theme, file size limit, default domain pack, AI tone/model).

**Core Shell (Phase 02):**
- Permanent left navigation that does not change with the tenant: Home, Workspaces, Data, Analytics, Outputs, Governance, Settings (Data / Analytics / Outputs are collapsible groups with sub-items).
- Top-level pages: `/` (Home with welcome card, recent workspaces/dashboards, and 5 quick actions: Upload, Create workspace, Ask Gen-BI, Generate dashboard, Try a sample pack), `/workspaces` (cards showing pack, files/dashboards counts, owner, status, readiness, and last-updated relative time), `/workspaces/:id/:tab?` (header + Upload→Understand→Clean→Join→Metrics→Dashboard→Ask→Report stepper, with each of the 7 tabs — Overview, Files, Prepared, Dashboards, Insights, Reports, Governance — backed by a real shareable route segment), and `/settings` (5 tabs: Organization, Theme, File limits, Domain packs, AI behavior — all fields persist via `PATCH /api/settings`).
- 5 domain packs (Insurance Broker, E-commerce Sales, SaaS Metrics, Marketing Funnel, Generic) each carry a copilot name, suggested prompts and starter metrics. The right-rail Copilot reads from the active workspace's pack via a URL-derived `useActiveWorkspace()` context, falling back to the global tenant config elsewhere.
- Backend endpoints: `GET/POST /api/workspaces`, `GET /api/workspaces/:id`, `GET/PATCH /api/settings` (settings auto-creates a single "default" user row; will be keyed per authenticated user once auth ships).

**AI Integration (Gen-BI Copilot):**
- Utilizes OpenAI (gpt-4.1-mini) via Replit AI Integrations.
- Features generative BI, creating inline chart visualizations directly within chat responses.
- Supports streaming AI responses via Server-Sent Events.
- Injects full data context from the tenant configuration into AI prompts.
- Enables dashboard navigation and dynamic dashboard creation through AI commands.

**Data Ingestion & Auto-Dashboard Generation:**
- Supports drag-and-drop CSV/XLSX/XLS file uploads with a 60 MB limit.
- Backend parses uploaded files, extracts row data and column metadata, and performs numeric column statistics.
- AI dashboard generation uses gpt-4.1-mini, sampling up to 150 rows of prepared data for the prompt.
- Supports over 10 visualization types (e.g., area, bar, line, pie, scatter, treemap).

**Tableau-like Data Preparation:**
- Client-side data operations pipeline for multi-file workflows.
- Supports joins (inner, left, right, outer), filters, aggregations, and calculated columns.
- Provides a live preview of data transformations.
- Includes a heuristic for suggesting potential joins between tables.
- Generated dashboards are persisted in `localStorage` and dynamically routed, appearing in the sidebar under "Your Data".

## External Dependencies

- **OpenAI:** Integrated for AI Copilot functionalities (gpt-4.1-mini).
- **PostgreSQL:** Used as the primary database.
- **Drizzle ORM:** Used for database interaction.
- **React:** Frontend library.
- **Vite:** Frontend build tool.
- **Tailwind CSS:** CSS framework.
- **Recharts:** Charting library.
- **shadcn/ui:** UI component library.
- **wouter:** Routing library for React.
- **Express:** Backend web framework.
- **Zod:** Schema validation library.
- **Orval:** API client code generation from OpenAPI.
- **esbuild:** For backend CJS bundle.
- **pnpm workspaces:** Monorepo management.
- **multer:** For handling file uploads on the backend.
- **xlsx:** For parsing Excel files.