# GenBI — Cloud Deployment & Multi-Org LWC Integration Plan

**Goal:** Deploy the GenBI application (Express API + React dashboard + Python agents) to a
public cloud URL, wire a Salesforce LWC navigation button in the Owners Portal to open it,
and architect the app to connect to **multiple Salesforce orgs** simultaneously so data from
every connected org flows into one dashboard.

---

## Architecture Overview

```
Salesforce (myNewOrg)                     Public Cloud
┌─────────────────────────────┐           ┌──────────────────────────────────────────┐
│  Owners Portal              │           │  GenBI App                               │
│  ┌──────────────────────┐  │  HTTPS    │  ┌─────────────┐   ┌──────────────────┐ │
│  │ genbiNavButton (LWC) │──┼──────────▶│  │  React SPA  │   │  Express API     │ │
│  └──────────────────────┘  │           │  │  :5173/dist │   │  :8080           │ │
│                             │           │  └──────┬──────┘   └────────┬─────────┘ │
│  ┌──────────────────────┐  │           │         │                    │           │
│  │ ownerAssistant (LWC) │  │           │  ┌──────▼──────────────────▼─────────┐  │
│  │  (existing)          │  │           │  │  PostgreSQL (managed cloud DB)    │  │
│  └──────────────────────┘  │           │  └──────────────────────────────────┘  │
└─────────────────────────────┘           └──────────────────────────────────────────┘
                                                       │  OAuth 2.0
                                          ┌────────────┼────────────────┐
                                          ▼            ▼                ▼
                                      myNewOrg      devOrg         orgC (future)
                                   (SF instance) (SF instance) (SF instance)
```

**Flow:** LWC button opens GenBI at `https://genbi.yourdomain.com?sfOrgDomain=<domain>`.
GenBI uses the org domain to look up stored OAuth tokens and fetches Salesforce data.
Each org is independently registered by an admin via a one-time OAuth flow inside GenBI.

---

## Phase 1 — Containerize the Application

### Why
The app currently runs as a local pnpm workspace. To deploy publicly it must be packaged
into reproducible containers.

### 1.1 — Dockerfile for the API Server

Create `artifacts/api-server/Dockerfile`:

```dockerfile
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install all workspace deps (needed for the build)
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY lib/db/package.json ./lib/db/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/integrations-openai-ai-server/package.json ./lib/integrations-openai-ai-server/
RUN pnpm install --frozen-lockfile

# Build
FROM deps AS build
COPY . .
RUN pnpm --filter @workspace/api-server run build

# Production image
FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=build /app/artifacts/api-server/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules
EXPOSE 8080
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
```

### 1.2 — Dockerfile for the React Dashboard

Create `artifacts/insurance-dashboard/Dockerfile`:

```dockerfile
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY artifacts/insurance-dashboard/package.json ./artifacts/insurance-dashboard/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/integrations-openai-ai-react/package.json ./lib/integrations-openai-ai-react/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# API_PROXY_TARGET is needed at build time only for the Vite proxy (dev). For production,
# set VITE_API_URL to the public API URL so the SPA calls the right backend.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @workspace/insurance-dashboard run build

# Serve via nginx
FROM nginx:alpine AS runner
COPY --from=build /app/artifacts/insurance-dashboard/dist /usr/share/nginx/html
COPY artifacts/insurance-dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

Create `artifacts/insurance-dashboard/nginx.conf`:

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # All routes fall back to index.html (SPA routing)
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Optional: proxy /api/* to the API container (if co-hosted)
    location /api/ {
        proxy_pass http://api:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 1.3 — Docker Compose (local integration test)

Create `docker-compose.yml` at repo root:

```yaml
version: "3.9"
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: genbi
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  api:
    build:
      context: .
      dockerfile: artifacts/api-server/Dockerfile
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@db:5432/genbi
      SESSION_SECRET: local-dev-secret
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      TENANT: insurance
      SF_LOGIN_URL: ${SF_LOGIN_URL}
      SF_CLIENT_ID: ${SF_CLIENT_ID}
      SF_CALLBACK_URL: http://localhost:8080/api/salesforce/oauth/callback
      APP_URL: http://localhost:80
    depends_on:
      - db

  dashboard:
    build:
      context: .
      dockerfile: artifacts/insurance-dashboard/Dockerfile
      args:
        VITE_API_URL: http://localhost:8080
    ports:
      - "80:80"
    depends_on:
      - api

  agents:
    build:
      context: services/agents-py
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@db:5432/genbi
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    depends_on:
      - db

volumes:
  pgdata:
```

---

## Phase 2 — Choose a Cloud Provider & Deploy

### Recommended: Railway

Railway natively supports pnpm monorepos, managed PostgreSQL, environment variable groups,
and custom domains with free TLS. Cost: ~$5/month for a small project.

Alternatives: **Render** (similar, slightly cheaper) or **Fly.io** (more control, more setup).

### 2.1 — Railway Setup Steps

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo.
2. Connect this repository.
3. Railway will detect the pnpm workspace. Create **three services**:
   - `genbi-api` — points to `artifacts/api-server/Dockerfile`
   - `genbi-dashboard` — points to `artifacts/insurance-dashboard/Dockerfile`
   - `genbi-agents` — points to `services/agents-py/` (Railway auto-detects Python)
4. Add a **PostgreSQL** plugin — Railway provisions a managed DB and injects `DATABASE_URL`.

### 2.2 — Environment Variables in Railway

Set these on the `genbi-api` service:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Auto-injected by Railway PostgreSQL plugin |
| `SESSION_SECRET` | Generate: `openssl rand -hex 32` |
| `OPENAI_API_KEY` | Your OpenAI key |
| `TENANT` | `insurance` |
| `SF_LOGIN_URL` | `https://login.salesforce.com` |
| `SF_CLIENT_ID` | Consumer key from GenBI_Local connected app |
| `SF_CALLBACK_URL` | `https://genbi-api.up.railway.app/api/salesforce/oauth/callback` |
| `APP_URL` | `https://genbi-dashboard.up.railway.app` |
| `AGENTS_SERVICE_URL` | `https://genbi-agents.up.railway.app` |

Set these on the `genbi-dashboard` service:

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://genbi-api.up.railway.app` |

### 2.3 — Initialize the Database

After first deploy, run schema push from Railway CLI or temporarily expose a one-shot command:

```bash
railway run --service genbi-api pnpm db:push
```

### 2.4 — Custom Domain (optional but recommended)

In Railway dashboard → `genbi-dashboard` service → Settings → Custom Domain →
add `genbi.yourcompany.com`. Railway provisions a Let's Encrypt TLS cert automatically.

Final public URLs (examples):
- **Dashboard:** `https://genbi.yourcompany.com`
- **API:** `https://api.genbi.yourcompany.com`

---

## Phase 3 — Multi-Org Architecture in the GenBI Backend

### Why
Currently GenBI reads a single Salesforce org from `SF_LOGIN_URL` + `SF_CLIENT_ID` env vars.
To support multiple orgs, each org must be independently registered, and its OAuth tokens
stored per-org in the database.

### 3.1 — New Database Table: `salesforce_orgs`

Add to `lib/db/src/schema/salesforce-orgs.ts`:

```typescript
import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const salesforceOrgs = pgTable("salesforce_orgs", {
  id: text("id").primaryKey(),             // e.g. "00Dxx0000001gER" (SF org ID)
  label: text("label").notNull(),           // human-readable name, e.g. "myNewOrg"
  instanceUrl: text("instance_url").notNull(), // e.g. "https://myorg.my.salesforce.com"
  loginUrl: text("login_url").notNull(),    // e.g. "https://login.salesforce.com"
  clientId: text("client_id").notNull(),   // connected app consumer key for this org
  accessToken: text("access_token"),        // encrypted at rest (see Phase 3.3)
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

Run `pnpm db:push` after adding this table.

### 3.2 — New API Routes for Org Management

Add `artifacts/api-server/src/routes/salesforce-orgs.ts`:

```
GET    /api/salesforce/orgs              → list all registered orgs
POST   /api/salesforce/orgs/connect      → begin OAuth for a new org
       body: { label, loginUrl, clientId, clientSecret }
       returns: { authUrl }  ← redirect user to this SF authorization URL
GET    /api/salesforce/orgs/callback     → OAuth callback, stores tokens, redirects to dashboard
DELETE /api/salesforce/orgs/:orgId       → remove an org
GET    /api/salesforce/orgs/:orgId/test  → test connection (run a lightweight SOQL query)
```

The OAuth flow per org:
1. Admin clicks "Connect Org" in GenBI Settings page
2. Frontend POSTs `{ label, loginUrl, clientId, clientSecret }` to `/api/salesforce/orgs/connect`
3. API builds SF authorization URL and returns it
4. Frontend redirects to SF login — user authenticates
5. SF redirects to `/api/salesforce/orgs/callback?code=...&state=...`
6. API exchanges code for access+refresh token, stores in `salesforce_orgs` table
7. Redirect to GenBI dashboard with `?orgConnected=true`

### 3.3 — Token Encryption

Salesforce tokens must be encrypted at rest. Use AES-256-GCM via Node's built-in `crypto`:

```typescript
// lib/db/src/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const KEY = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, "hex"); // 32-byte key

export function encrypt(text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(b => b.toString("hex")).join(".");
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, encHex] = payload.split(".");
  const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
}
```

Add `TOKEN_ENCRYPTION_KEY` to environment variables: `openssl rand -hex 32`.

### 3.4 — Org-Aware Data Fetching

All Salesforce data routes must accept an `orgId` parameter. Update
`artifacts/api-server/src/routes/salesforce.ts` to:

```typescript
// Before: hardcoded single org connection
// After: look up org by ID, use its stored token

router.get("/api/salesforce/data/:orgId/query", async (req, res) => {
  const org = await db.query.salesforceOrgs.findFirst({
    where: eq(salesforceOrgs.id, req.params.orgId),
  });
  if (!org) return res.status(404).json({ error: "Org not registered" });

  const conn = new jsforce.Connection({
    instanceUrl: org.instanceUrl,
    accessToken: decrypt(org.accessToken!),
    refreshToken: decrypt(org.refreshToken!),
    clientId: org.clientId,
  });

  const result = await conn.query(req.query.q as string);
  res.json(result);
});
```

### 3.5 — Org Selector in the Frontend

Add an org selector dropdown to the top navigation bar in
`artifacts/insurance-dashboard/src/components/layout.tsx`:

```tsx
// OrgSelector component
function OrgSelector() {
  const { data: orgs } = useQuery({ queryKey: ["/api/salesforce/orgs"] });
  const [selectedOrgId, setSelectedOrgId] = useLocalStorage("selectedOrgId", null);

  return (
    <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="Select org..." />
      </SelectTrigger>
      <SelectContent>
        {orgs?.map(org => (
          <SelectItem key={org.id} value={org.id}>{org.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

The selected `orgId` is stored in `localStorage` and passed as a query param
to every API call that fetches Salesforce data.

### 3.6 — Reports Page: Multi-Org Data Pull

The Reports page (`artifacts/insurance-dashboard/src/pages/Reports.tsx`) fetches
Salesforce `DCR__c` data. Update it to:

1. Read `selectedOrgId` from context/localStorage
2. Pass `orgId` in the API request
3. Show an "All Orgs" option that aggregates across all registered orgs in parallel

---

## Phase 4 — Salesforce LWC: Navigation Button

### Why
Users in the Salesforce Owners Portal need a single click to open the deployed GenBI
dashboard, pre-scoped to their org.

### 4.1 — Create the LWC: `genbiNavButton`

Create the following file structure:

```
salesforce/force-app/main/default/lwc/genbiNavButton/
├── genbiNavButton.js
├── genbiNavButton.html
└── genbiNavButton.js-meta.xml
```

**`genbiNavButton.html`:**
```html
<template>
    <lightning-card title="GenBI Analytics" icon-name="utility:analytics">
        <div class="slds-p-around_medium">
            <p class="slds-m-bottom_medium slds-text-body_regular">
                Open the GenBI Insurance Intelligence Dashboard for this org.
            </p>
            <lightning-button
                label="Open GenBI Dashboard"
                icon-name="utility:new_window"
                icon-position="right"
                variant="brand"
                onclick={handleOpenGenBI}>
            </lightning-button>
            <template if:true={showConnectPrompt}>
                <p class="slds-m-top_small slds-text-color_weak slds-text-body_small">
                    First time? An admin must connect this org in GenBI Settings.
                </p>
            </template>
        </div>
    </lightning-card>
</template>
```

**`genbiNavButton.js`:**
```javascript
import { LightningElement, wire } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';
import { getOrgId } from '@salesforce/apex/GenBINavController.getOrgId';

// Replace with your deployed dashboard URL
const GENBI_BASE_URL = 'https://genbi.yourcompany.com';

export default class GenbiNavButton extends LightningElement {
    @wire(CurrentPageReference)
    pageRef;

    orgId;
    showConnectPrompt = false;

    connectedCallback() {
        // Get the current org's 18-char ID via Apex
        getOrgId()
            .then(result => { this.orgId = result; })
            .catch(() => { this.showConnectPrompt = true; });
    }

    handleOpenGenBI() {
        const params = new URLSearchParams({
            sfOrgId: this.orgId || '',
            sfInstanceUrl: window.location.origin,
        });
        const url = `${GENBI_BASE_URL}?${params.toString()}`;
        window.open(url, '_blank', 'noopener,noreferrer');
    }
}
```

**`genbiNavButton.js-meta.xml`:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>64.0</apiVersion>
    <isExposed>true</isExposed>
    <targets>
        <target>lightning__AppPage</target>
        <target>lightning__RecordPage</target>
        <target>lightning__HomePage</target>
    </targets>
    <targetConfigs>
        <targetConfig targets="lightning__AppPage,lightning__HomePage">
            <property name="genbiUrl" type="String"
                label="GenBI Dashboard URL"
                description="Override the default GenBI dashboard URL."
                default="https://genbi.yourcompany.com"/>
        </targetConfig>
    </targetConfigs>
</LightningComponentBundle>
```

### 4.2 — Apex Helper: `GenBINavController`

Create `salesforce/force-app/main/default/classes/GenBINavController.cls`:

```apex
public with sharing class GenBINavController {
    @AuraEnabled(cacheable=true)
    public static String getOrgId() {
        return UserInfo.getOrganizationId();
    }

    @AuraEnabled(cacheable=true)
    public static String getCurrentUserInfo() {
        return JSON.serialize(new Map<String, String>{
            'orgId'     => UserInfo.getOrganizationId(),
            'userId'    => UserInfo.getUserId(),
            'userName'  => UserInfo.getUserName(),
            'orgName'   => UserInfo.getOrganizationName()
        });
    }
}
```

### 4.3 — Deploy to myNewOrg

```bash
cd salesforce

sf project deploy start \
  --source-dir force-app/main/default/lwc/genbiNavButton \
  --source-dir force-app/main/default/classes/GenBINavController.cls \
  --source-dir force-app/main/default/classes/GenBINavController.cls-meta.xml \
  --target-org myNewOrg
```

### 4.4 — Add to the Owners Portal Page

1. Go to **myNewOrg Setup → Lightning App Builder**
2. Open the **Owners Portal** app page
3. In the component palette (left) search for **"GenBI"**
4. Drag **GenBI Analytics** onto the page layout
5. In the right-side properties panel, optionally override the GenBI Dashboard URL
6. Click **Save** → **Activate**

---

## Phase 5 — GenBI App Reads Salesforce Context from URL

When a user clicks the button in Salesforce, GenBI opens with `?sfOrgId=&sfInstanceUrl=`.
The app uses this to pre-select the correct org in the org selector.

### 5.1 — Read URL Params on App Load

Add to `artifacts/insurance-dashboard/src/App.tsx`:

```typescript
import { useEffect } from "react";
import { useLocalStorage } from "@/hooks/use-local-storage";

function SalesforceContextBridge() {
  const [, setSelectedOrgId] = useLocalStorage("selectedOrgId", null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sfOrgId = params.get("sfOrgId");
    const sfInstanceUrl = params.get("sfInstanceUrl");

    if (sfOrgId) {
      // Match sfOrgId to our registered orgs (15-char vs 18-char safe compare)
      fetch(`/api/salesforce/orgs?sfOrgId=${sfOrgId}`)
        .then(r => r.json())
        .then(orgs => {
          if (orgs.length > 0) setSelectedOrgId(orgs[0].id);
        });
    }
  }, []);

  return null;
}
```

Mount `<SalesforceContextBridge />` at the top of the app tree inside `App.tsx`.

### 5.2 — CORS Configuration

The GenBI API must allow requests from the Salesforce org domains. Add to
`artifacts/api-server/src/app.ts`:

```typescript
import cors from "cors";

app.use(cors({
  origin: (origin, callback) => {
    // Allow Salesforce org domains and your dashboard domain
    const allowed = [
      /\.salesforce\.com$/,
      /\.force\.com$/,
      /\.my\.salesforce\.com$/,
      process.env.APP_URL!,
    ];
    if (!origin || allowed.some(p => typeof p === "string" ? p === origin : p.test(origin))) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));
```

---

## Phase 6 — Multi-Org Admin Settings Page in GenBI

Add an **Org Connections** settings screen so admins can register new Salesforce orgs
without touching environment variables.

### 6.1 — New Page: `OrgConnections`

Create `artifacts/insurance-dashboard/src/pages/OrgConnections.tsx`:

```
/settings/orgs                  → list all connected orgs + status
/settings/orgs/connect          → form: label, loginUrl, clientId, clientSecret → initiates OAuth
```

The page shows a table:

| Org Label | Instance URL | Connected At | Status | Actions |
|---|---|---|---|---|
| myNewOrg | https://myorg.my.salesforce.com | 2026-06-16 | ✅ Active | Test / Remove |
| devOrg | https://devorg.my.salesforce.com | 2026-06-16 | ✅ Active | Test / Remove |
| clientOrg | — | — | Not connected | Connect |

### 6.2 — Add to Nav Config

In `artifacts/insurance-dashboard/src/lib/nav-config.ts`, add:

```typescript
{
  href: "/settings/orgs",
  label: "Org Connections",
  icon: "Building2",
}
```

---

## Phase 7 — Update the SF Connected App for Production Callback

The `GenBI_Local` connected app in each org must have the production callback URL added.

### 7.1 — Update devOrg's GenBI_CrossOrg Callback URL

In **devOrg Setup → App Manager → GenBI Cross-Org → Edit**:

Under OAuth Settings → Callback URL, add (one per line):
```
https://login.salesforce.com/services/oauth2/success
https://genbi-api.up.railway.app/api/salesforce/orgs/callback
```

### 7.2 — Update myNewOrg's GenBI_Local Callback URL

In **myNewOrg Setup → App Manager → GenBI Local → Edit**, add:
```
https://genbi-api.up.railway.app/api/salesforce/orgs/callback
```

---

## Phase 8 — Security Hardening

| Area | What to do |
|---|---|
| **Token storage** | Encrypt `accessToken` and `refreshToken` at rest (Phase 3.3) |
| **Token rotation** | Use `refreshToken` to auto-renew before expiry; store new `accessToken` |
| **Org isolation** | Every DB query scoped by `orgId` — never mix org data |
| **Session auth** | GenBI uses `SESSION_SECRET`-signed cookies; add a login page or SSO |
| **CORS** | Allow only Salesforce domains + your dashboard domain (Phase 5.2) |
| **HTTPS only** | Railway/Render enforce TLS automatically |
| **Rate limiting** | Add `express-rate-limit` on the API; especially `/api/salesforce/*` routes |
| **Audit log** | Log every org connection/disconnection event with user + timestamp |

---

## Execution Checklist

### Phase 1 — Containerize
- [ ] Create `artifacts/api-server/Dockerfile`
- [ ] Create `artifacts/insurance-dashboard/Dockerfile`
- [ ] Create `artifacts/insurance-dashboard/nginx.conf`
- [ ] Create `docker-compose.yml`
- [ ] Test locally: `docker compose up --build`
- [ ] Confirm dashboard loads at `http://localhost` and API at `http://localhost:8080/api/health`

### Phase 2 — Cloud Deploy
- [ ] Create Railway project, connect GitHub repo
- [ ] Add three services: `genbi-api`, `genbi-dashboard`, `genbi-agents`
- [ ] Add PostgreSQL plugin
- [ ] Set all environment variables
- [ ] Run `pnpm db:push` against production DB
- [ ] Note final public URLs
- [ ] Test: open dashboard URL in browser

### Phase 3 — Multi-Org Backend
- [ ] Add `salesforce_orgs` table to `lib/db/src/schema/`
- [ ] Run `pnpm db:push`
- [ ] Implement `artifacts/api-server/src/routes/salesforce-orgs.ts`
- [ ] Add `TOKEN_ENCRYPTION_KEY` env var to Railway
- [ ] Add crypto util `lib/db/src/crypto.ts`
- [ ] Update existing Salesforce routes to accept `orgId`
- [ ] Add org selector to frontend layout
- [ ] Test: register myNewOrg via OAuth, verify data fetch

### Phase 4 — LWC Button
- [ ] Create `salesforce/force-app/main/default/lwc/genbiNavButton/`
- [ ] Create `salesforce/force-app/main/default/classes/GenBINavController.cls`
- [ ] Deploy to myNewOrg via `sf project deploy start`
- [ ] Add to Owners Portal page via Lightning App Builder
- [ ] Test: click button → GenBI opens in new tab with `?sfOrgId=...`

### Phase 5 — URL Context Bridge
- [ ] Add `SalesforceContextBridge` component to `App.tsx`
- [ ] Add `/api/salesforce/orgs?sfOrgId=` lookup endpoint
- [ ] Configure CORS in `app.ts`
- [ ] Test: opening GenBI from SF pre-selects the correct org

### Phase 6 — Admin Settings Page
- [ ] Create `OrgConnections.tsx` page
- [ ] Add route to `App.tsx`
- [ ] Add nav entry to `nav-config.ts`
- [ ] Test: connect devOrg from GenBI settings → data appears in Reports

### Phase 7 — Callback URL Updates
- [ ] Update devOrg GenBI_CrossOrg callback URL to include production URL
- [ ] Update myNewOrg GenBI_Local callback URL to include production URL

### Phase 8 — Security
- [ ] Verify token encryption is working (`accessToken` column in DB is not plaintext)
- [ ] Add `express-rate-limit` to API
- [ ] Verify CORS rejects requests from non-SF domains
- [ ] Run `pnpm typecheck` — no type errors

---

## File Change Summary

| File | Action |
|---|---|
| `artifacts/api-server/Dockerfile` | **Create** |
| `artifacts/insurance-dashboard/Dockerfile` | **Create** |
| `artifacts/insurance-dashboard/nginx.conf` | **Create** |
| `docker-compose.yml` | **Create** |
| `lib/db/src/schema/salesforce-orgs.ts` | **Create** |
| `lib/db/src/crypto.ts` | **Create** |
| `artifacts/api-server/src/routes/salesforce-orgs.ts` | **Create** |
| `artifacts/api-server/src/routes/salesforce.ts` | **Update** — add `orgId` param |
| `artifacts/api-server/src/app.ts` | **Update** — add CORS config |
| `artifacts/insurance-dashboard/src/App.tsx` | **Update** — add `SalesforceContextBridge` |
| `artifacts/insurance-dashboard/src/components/layout.tsx` | **Update** — add org selector |
| `artifacts/insurance-dashboard/src/lib/nav-config.ts` | **Update** — add Org Connections nav item |
| `artifacts/insurance-dashboard/src/pages/OrgConnections.tsx` | **Create** |
| `salesforce/force-app/main/default/lwc/genbiNavButton/` | **Create** (3 files) |
| `salesforce/force-app/main/default/classes/GenBINavController.cls` | **Create** |
| `salesforce/force-app/main/default/classes/GenBINavController.cls-meta.xml` | **Create** |

---

## Estimated Timeline

| Phase | Effort |
|---|---|
| Phase 1 — Containerize | 2–3 hours |
| Phase 2 — Cloud Deploy | 1–2 hours |
| Phase 3 — Multi-Org Backend | 4–6 hours |
| Phase 4 — LWC Button | 1–2 hours |
| Phase 5 — URL Context Bridge | 1 hour |
| Phase 6 — Admin Settings Page | 2–3 hours |
| Phase 7 — Callback URLs | 30 minutes |
| Phase 8 — Security | 1–2 hours |
| **Total** | **~14–20 hours** |
