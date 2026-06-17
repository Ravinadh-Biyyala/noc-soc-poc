# GenBI — Multi-Org Owners Portal: Development Plan

**Lens:** Different Salesforce org owners will open this application from their Owners Portal
(via an LWC nav button). When they open it, GenBI must know which org they came from, authenticate
them against that org, and query only that org's Salesforce objects — with no cross-org data leakage.

---

## Current State — What Needs to Change

The current `salesforce.ts` route has two critical problems for a multi-org scenario:

| Problem | Current Code | What We Need |
|---|---|---|
| **Single shared token** | `let tokens: SfTokens \| null` — one global token, on disk | Per-user, per-org token stored in DB with encrypted columns |
| **Single org hardcoded** | `SF_LOGIN_URL` and `SF_CLIENT_ID` from env vars | Org registry in DB; each org has its own client ID + login URL |
| **No user identity** | Any visitor uses the same SF token | OAuth issues tokens to the individual user; GenBI scopes all queries to that user's SF permissions |
| **No session** | Stateless; tokens on disk | Server-side sessions; each browser session tied to one user+org pair |
| **No object config** | DCR columns hardcoded in the route | Per-org object configuration stored in DB; admin selects which objects/fields to expose |

---

## Architecture: How Context Flows from LWC → GenBI

```
Salesforce Owners Portal (myNewOrg / devOrg / any org)
│
│  LWC genbiNavButton
│  button click → window.open("https://genbi.com?orgKey=abc123")
│                                              └── opaque UUID, not the SF org ID
│
▼
GenBI Express API
│
│  GET /?orgKey=abc123
│  middleware: lookup org in DB by orgKey
│              does this browser have a valid SF session for this org? NO
│              → initiate PKCE OAuth against org's SF instance
│
▼
Salesforce OAuth (org-specific login URL)
│  User logs in with their SF credentials
│  SF redirects → GET /api/auth/callback?code=...&state=orgKey:abc123:nonce:xyz
│
▼
GenBI API — callback handler
│  Verify state nonce (CSRF protection)
│  Exchange code for access_token + refresh_token (PKCE)
│  Decrypt and store tokens in DB: (orgId, sfUserId) → encrypted token pair
│  Create server-side session: { orgId, sfUserId, sfInstanceUrl }
│  Redirect → GenBI dashboard
│
▼
GenBI React Dashboard
│  Reads org config: which objects/fields are configured for this org?
│  Renders sections, queries data via /api/sf/:orgId/query
│  All API calls carry session cookie → server validates org+user → routes to correct SF instance
```

**Key security property:** The `orgKey` in the URL is only a lookup hint. It never proves identity.
Actual authentication is done by Salesforce — the user must complete the SF login. The `orgKey`
just tells GenBI which SF instance to redirect them to.

---

## Phase 1 — Database: Org Registry + Token Storage

### 1.1 New table: `sf_orgs`

File to create: `lib/db/src/schema/sf-orgs.ts`

```typescript
import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const sfOrgs = pgTable("sf_orgs", {
  // orgKey: opaque UUID shown in LWC URL — never the real SF org ID
  orgKey:       text("org_key").primaryKey(),
  // Human label for the admin UI
  label:        text("label").notNull(),
  // The SF 18-char org ID (obtained after first OAuth, used for dedup)
  sfOrgId:      text("sf_org_id").unique(),
  // Base URL for OAuth + API calls, e.g. "https://orgfarm-xxx.develop.my.salesforce.com"
  instanceUrl:  text("instance_url").notNull(),
  // Which SF login endpoint to use (could differ per sandbox/prod)
  loginUrl:     text("login_url").notNull().default("https://login.salesforce.com"),
  // Consumer key of the Connected App deployed in that org
  clientId:     text("client_id").notNull(),
  // Consumer secret — encrypted at rest using AES-256-GCM
  clientSecret: text("client_secret_enc"),
  isActive:     boolean("is_active").notNull().default(true),
  createdAt:    timestamp("created_at").defaultNow(),
});
```

### 1.2 New table: `sf_user_tokens`

One row per (SF user × org) pair. This is what drives per-user data isolation.

```typescript
export const sfUserTokens = pgTable("sf_user_tokens", {
  id:              text("id").primaryKey(),         // uuid
  orgKey:          text("org_key").notNull()
                    .references(() => sfOrgs.orgKey, { onDelete: "cascade" }),
  sfUserId:        text("sf_user_id").notNull(),    // 18-char SF User ID
  sfUsername:      text("sf_username"),
  // Both tokens encrypted at rest — never stored plaintext
  accessTokenEnc:  text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc"),
  tokenExpiresAt:  timestamp("token_expires_at"),
  createdAt:       timestamp("created_at").defaultNow(),
  updatedAt:       timestamp("updated_at").defaultNow(),
}, (t) => ({
  uniq: unique().on(t.orgKey, t.sfUserId),          // one token row per user per org
}));
```

### 1.3 New table: `sf_org_objects`

Replaces the hardcoded `DCR_COLUMNS` array. Each row = one object allowed for one org.

```typescript
export const sfOrgObjects = pgTable("sf_org_objects", {
  id:            text("id").primaryKey(),
  orgKey:        text("org_key").notNull()
                  .references(() => sfOrgs.orgKey, { onDelete: "cascade" }),
  objectApiName: text("object_api_name").notNull(),  // e.g. "DCR__c"
  displayLabel:  text("display_label").notNull(),     // e.g. "Data Change Requests"
  // JSON array of { apiName, label } — the fields allowed to be queried
  allowedFields: text("allowed_fields").notNull(),    // JSON stored as text
  // SOQL ORDER BY clause, e.g. "LastModifiedDate DESC"
  defaultOrderBy: text("default_order_by").default("LastModifiedDate DESC"),
  defaultLimit:  text("default_limit").default("500"),
  isActive:      boolean("is_active").notNull().default(true),
});
```

After adding all three tables run: `pnpm db:push`

### 1.4 Token Encryption Utility

File to create: `artifacts/api-server/src/lib/crypto.ts`

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// TOKEN_ENCRYPTION_KEY must be 64 hex chars (= 32 bytes)
// Generate with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const KEY = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? "", "hex");

export function encryptToken(plain: string): string {
  if (KEY.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  const iv  = randomBytes(12);
  const c   = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return [iv, tag, enc].map(b => b.toString("base64url")).join(".");
}

export function decryptToken(payload: string): string {
  const [ivB64, tagB64, encB64] = payload.split(".");
  const d = createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivB64, "base64url"));
  d.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    d.update(Buffer.from(encB64, "base64url")),
    d.final(),
  ]).toString("utf8");
}
```

Add `TOKEN_ENCRYPTION_KEY` to `.env.example`:
```
TOKEN_ENCRYPTION_KEY=<run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
```

---

## Phase 2 — Server-Side Sessions

The current code has **no session layer**. Every org owner who opens GenBI needs their own
authenticated session tied to their SF user identity.

### 2.1 Install session middleware

```bash
pnpm --filter @workspace/api-server add express-session connect-pg-simple
pnpm --filter @workspace/api-server add -D @types/express-session @types/connect-pg-simple
```

### 2.2 Mount in `artifacts/api-server/src/app.ts`

```typescript
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

const PgStore = connectPgSimple(session);

app.use(session({
  store: new PgStore({
    conString: process.env.DATABASE_URL,
    tableName: "user_sessions",   // auto-created by connect-pg-simple
    ttl: 60 * 60 * 8,             // 8-hour session lifetime
    pruneSessionInterval: 60,     // prune expired sessions every 60s
  }),
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  name: "genbi.sid",
  cookie: {
    httpOnly: true,       // no JS access to cookie
    secure: process.env.NODE_ENV === "production",  // HTTPS only in prod
    sameSite: "lax",      // allows cross-site GET (needed for SF OAuth redirect back)
    maxAge: 1000 * 60 * 60 * 8,  // 8 hours
  },
}));
```

### 2.3 Session type declaration

File: `artifacts/api-server/src/types/session.d.ts`

```typescript
import "express-session";

declare module "express-session" {
  interface SessionData {
    orgKey: string;           // which org this session belongs to
    sfUserId: string;         // 18-char SF user ID
    sfUsername: string;
    sfInstanceUrl: string;    // for building API URLs without a DB roundtrip
    tokenRowId: string;       // FK into sf_user_tokens table
  }
}
```

---

## Phase 3 — Rewrite `salesforce.ts`: Multi-Org, Per-User Auth

Replace the current `salesforce.ts` entirely. New structure:

### 3.1 Org-Aware PKCE Login — `GET /api/sf/auth/login`

```typescript
// Request: GET /api/sf/auth/login?orgKey=abc123
// Effect:  redirect browser to that org's SF OAuth page

router.get("/sf/auth/login", async (req, res) => {
  const { orgKey } = req.query as { orgKey?: string };
  if (!orgKey) return res.status(400).json({ error: "orgKey is required" });

  const org = await db.query.sfOrgs.findFirst({
    where: and(eq(sfOrgs.orgKey, orgKey), eq(sfOrgs.isActive, true)),
  });
  if (!org) return res.status(404).json({ error: "Unknown org" });

  // PKCE
  const verifier   = b64url(randomBytes(64));
  const nonce      = b64url(randomBytes(24));
  const challenge  = b64url(createHash("sha256").update(verifier).digest());

  // state encodes both orgKey and nonce — verified in callback
  const state = `${orgKey}::${nonce}`;
  pendingAuth.set(state, { verifier, orgKey });   // in-memory, short-lived (5 min TTL)

  const url = new URL(`${org.loginUrl}/services/oauth2/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", org.clientId);
  url.searchParams.set("redirect_uri", SF_CALLBACK_URL);
  url.searchParams.set("scope", "api refresh_token");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  res.redirect(url.toString());
});
```

### 3.2 OAuth Callback — `GET /api/sf/auth/callback`

```typescript
router.get("/sf/auth/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error) return res.redirect(`${APP_URL}?sf_error=${encodeURIComponent(error)}`);

  const pending = pendingAuth.get(state);
  pendingAuth.delete(state);
  if (!pending || !code) return res.redirect(`${APP_URL}?sf_error=expired`);

  const org = await db.query.sfOrgs.findFirst({
    where: eq(sfOrgs.orgKey, pending.orgKey),
  });
  if (!org) return res.redirect(`${APP_URL}?sf_error=unknown_org`);

  // Exchange code → tokens
  const tokenRes = await fetch(`${org.loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      client_id:     org.clientId,
      redirect_uri:  SF_CALLBACK_URL,
      code,
      code_verifier: pending.verifier,
    }).toString(),
  });
  const body = await tokenRes.json();
  if (!tokenRes.ok) return res.redirect(`${APP_URL}?sf_error=${encodeURIComponent(body.error_description)}`);

  const sfUserId = (body.id as string).split("/").pop()!;  // SF user ID from identity URL

  // Upsert token row — one row per (orgKey × sfUserId)
  const tokenRowId = randomUUID();
  await db.insert(sfUserTokens).values({
    id:              tokenRowId,
    orgKey:          org.orgKey,
    sfUserId,
    sfUsername:      body.id,
    accessTokenEnc:  encryptToken(body.access_token),
    refreshTokenEnc: body.refresh_token ? encryptToken(body.refresh_token) : null,
    tokenExpiresAt:  new Date(Date.now() + 2 * 60 * 60 * 1000),  // 2h default
    updatedAt:       new Date(),
  }).onConflictDoUpdate({
    target: [sfUserTokens.orgKey, sfUserTokens.sfUserId],
    set: {
      accessTokenEnc:  encryptToken(body.access_token),
      refreshTokenEnc: body.refresh_token ? encryptToken(body.refresh_token) : null,
      tokenExpiresAt:  new Date(Date.now() + 2 * 60 * 60 * 1000),
      updatedAt:       new Date(),
    },
  });

  // Set server-side session
  req.session.orgKey        = org.orgKey;
  req.session.sfUserId      = sfUserId;
  req.session.sfInstanceUrl = body.instance_url;
  req.session.tokenRowId    = tokenRowId;

  await req.session.save();
  res.redirect(`${APP_URL}?org=${org.orgKey}`);
});
```

### 3.3 Auth Guard Middleware

All data routes are protected by this middleware. Put it in
`artifacts/api-server/src/middleware/requireSfAuth.ts`:

```typescript
import type { Request, Response, NextFunction } from "express";

export function requireSfAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.orgKey || !req.session?.sfUserId) {
    // Return the login URL so the frontend can redirect
    const orgKey = req.query.orgKey as string | undefined;
    res.status(401).json({
      error:    "Not authenticated",
      loginUrl: orgKey ? `/api/sf/auth/login?orgKey=${orgKey}` : null,
    });
    return;
  }
  next();
}
```

---

## Phase 4 — Per-Org Query Execution

### 4.1 Token refresh utility

```typescript
// artifacts/api-server/src/lib/sf-client.ts

export async function getSfClient(orgKey: string, sfUserId: string) {
  const row = await db.query.sfUserTokens.findFirst({
    where: and(
      eq(sfUserTokens.orgKey, orgKey),
      eq(sfUserTokens.sfUserId, sfUserId),
    ),
  });
  if (!row) throw Object.assign(new Error("No token found — re-authenticate"), { status: 401 });

  const org = await db.query.sfOrgs.findFirst({ where: eq(sfOrgs.orgKey, orgKey) });
  if (!org) throw new Error("Org not found");

  let accessToken = decryptToken(row.accessTokenEnc);

  // Attempt refresh if expired or near expiry
  const isExpired = row.tokenExpiresAt && row.tokenExpiresAt < new Date(Date.now() + 5 * 60_000);
  if (isExpired && row.refreshTokenEnc) {
    const refreshRes = await fetch(`${org.loginUrl}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "refresh_token",
        client_id:     org.clientId,
        refresh_token: decryptToken(row.refreshTokenEnc),
      }).toString(),
    });
    if (refreshRes.ok) {
      const body = await refreshRes.json();
      accessToken = body.access_token;
      await db.update(sfUserTokens)
        .set({
          accessTokenEnc: encryptToken(body.access_token),
          tokenExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          updatedAt:      new Date(),
        })
        .where(and(
          eq(sfUserTokens.orgKey, orgKey),
          eq(sfUserTokens.sfUserId, sfUserId),
        ));
    }
  }

  return { instanceUrl: org.instanceUrl, accessToken };
}
```

### 4.2 Data Query Route — `GET /api/sf/:orgKey/objects/:objectName`

This replaces the hardcoded `/salesforce/reports/dcr` route:

```typescript
router.get("/sf/:orgKey/objects/:objectName", requireSfAuth, async (req, res) => {
  const { orgKey, objectName } = req.params;

  // Session must match the requested org — prevent cross-org access
  if (req.session.orgKey !== orgKey) {
    return res.status(403).json({ error: "Session org does not match requested org" });
  }

  // Validate the object is configured and allowed for this org
  const objConfig = await db.query.sfOrgObjects.findFirst({
    where: and(
      eq(sfOrgObjects.orgKey, orgKey),
      eq(sfOrgObjects.objectApiName, objectName),
      eq(sfOrgObjects.isActive, true),
    ),
  });
  if (!objConfig) {
    return res.status(404).json({ error: `Object ${objectName} is not configured for this org` });
  }

  const fields = (JSON.parse(objConfig.allowedFields) as Array<{ apiName: string }>)
    .map(f => f.apiName);

  // Build SOQL from the allow-list — never interpolate user input
  const soql =
    `SELECT Id, ${fields.join(", ")} ` +
    `FROM ${objectName} ` +
    `ORDER BY ${objConfig.defaultOrderBy} ` +
    `LIMIT ${objConfig.defaultLimit}`;

  const { instanceUrl, accessToken } = await getSfClient(orgKey, req.session.sfUserId);

  const sfRes = await fetch(
    `${instanceUrl}/services/data/v64.0/query?q=${encodeURIComponent(soql)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!sfRes.ok) {
    const body = await sfRes.json().catch(() => []);
    return res.status(sfRes.status === 401 ? 401 : 502).json({
      error: body?.[0]?.message ?? `Salesforce returned ${sfRes.status}`,
    });
  }

  const data = await sfRes.json();
  const columns = JSON.parse(objConfig.allowedFields) as Array<{ apiName: string; label: string }>;
  const records = data.records.map(({ attributes: _a, ...rest }: Record<string, unknown>) => rest);

  res.json({
    objectName,
    displayLabel: objConfig.displayLabel,
    columns,
    records,
    totalSize: data.totalSize,
    fetchedAt: new Date().toISOString(),
  });
});
```

### 4.3 List Configured Objects — `GET /api/sf/:orgKey/objects`

```typescript
router.get("/sf/:orgKey/objects", requireSfAuth, async (req, res) => {
  if (req.session.orgKey !== req.params.orgKey) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const objects = await db.query.sfOrgObjects.findMany({
    where: and(
      eq(sfOrgObjects.orgKey, req.params.orgKey),
      eq(sfOrgObjects.isActive, true),
    ),
  });
  res.json(objects.map(o => ({
    objectApiName: o.objectApiName,
    displayLabel:  o.displayLabel,
    fieldCount:    (JSON.parse(o.allowedFields) as unknown[]).length,
  })));
});
```

---

## Phase 5 — Salesforce LWC: `genbiNavButton`

### 5.1 File structure

```
salesforce/force-app/main/default/lwc/genbiNavButton/
├── genbiNavButton.html
├── genbiNavButton.js
└── genbiNavButton.js-meta.xml
```

### 5.2 `genbiNavButton.html`

```html
<template>
    <lightning-card title="GenBI Analytics" icon-name="utility:chart">
        <div class="slds-p-around_medium slds-text-align_center">
            <lightning-button
                label="Open GenBI Dashboard"
                variant="brand"
                icon-name="utility:new_window"
                icon-position="right"
                onclick={openDashboard}
                disabled={isLoading}>
            </lightning-button>
            <template if:true={errorMessage}>
                <p class="slds-m-top_small slds-text-color_error">{errorMessage}</p>
            </template>
        </div>
    </lightning-card>
</template>
```

### 5.3 `genbiNavButton.js`

```javascript
import { LightningElement, api } from 'lwc';

export default class GenbiNavButton extends LightningElement {
    // Admin sets this in Lightning App Builder → points to GenBI deployment
    // Value format: "https://genbi.yourcompany.com?orgKey=<UUID>"
    @api genbiUrl = '';

    isLoading = false;
    errorMessage = '';

    openDashboard() {
        if (!this.genbiUrl) {
            this.errorMessage = 'GenBI URL is not configured. Contact your administrator.';
            return;
        }
        // Open in a new tab — no sensitive data in URL beyond orgKey
        window.open(this.genbiUrl, '_blank', 'noopener,noreferrer');
    }
}
```

### 5.4 `genbiNavButton.js-meta.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>64.0</apiVersion>
    <isExposed>true</isExposed>
    <targets>
        <target>lightning__AppPage</target>
        <target>lightning__RecordPage</target>
        <target>lightning__HomePage</target>
        <target>lightning__FlowScreen</target>
    </targets>
    <targetConfigs>
        <targetConfig targets="lightning__AppPage,lightning__HomePage,lightning__RecordPage">
            <property
                name="genbiUrl"
                type="String"
                label="GenBI Dashboard URL (with orgKey)"
                description="Full URL including ?orgKey=. Example: https://genbi.yourcompany.com?orgKey=abc123" />
        </targetConfig>
    </targetConfigs>
</LightningComponentBundle>
```

**Why orgKey in URL is safe:**
The `orgKey` is an opaque UUID. It tells GenBI _which org_ to authenticate against — not _who_ the
user is. The user still must complete full SF OAuth before seeing any data. A leaked `orgKey` only
lets someone see the SF login page for that org (same as knowing the org domain).

### 5.5 Deploying the LWC

```bash
cd salesforce

sf project deploy start \
  --source-dir force-app/main/default/lwc/genbiNavButton \
  --target-org myNewOrg

# Repeat for devOrg or any other org — same LWC, different orgKey value in App Builder
sf project deploy start \
  --source-dir force-app/main/default/lwc/genbiNavButton \
  --target-org devOrg
```

### 5.6 Wiring up in Lightning App Builder (each org separately)

1. **myNewOrg Setup → Lightning App Builder → Owners Portal page**
2. Drag **GenBI Analytics** (genbiNavButton) onto the page
3. In the right-side properties panel, set **GenBI Dashboard URL**:
   `https://genbi.yourcompany.com?orgKey=<UUID registered for myNewOrg>`
4. Save and Activate

5. Repeat for **devOrg** with `orgKey=<UUID registered for devOrg>`

Each org gets a different `orgKey` value — same component, different configuration.

---

## Phase 6 — Admin Org Registration Flow

Before a Salesforce org owner can use GenBI, an admin registers that org in GenBI.
This is a one-time setup step per org.

### 6.1 Admin API Routes

File: `artifacts/api-server/src/routes/sf-admin.ts`

```
POST /api/admin/orgs          Register a new org
                              body: { label, instanceUrl, loginUrl, clientId, clientSecret }
                              returns: { orgKey }  ← put this in the LWC property

GET  /api/admin/orgs          List all registered orgs

PATCH /api/admin/orgs/:orgKey Update an org's label or status

DELETE /api/admin/orgs/:orgKey Deactivate (soft delete)

POST /api/admin/orgs/:orgKey/objects   Add an object config
     body: { objectApiName, displayLabel, allowedFields: [{apiName, label}], defaultOrderBy, defaultLimit }

GET  /api/admin/orgs/:orgKey/objects   List configured objects for an org

DELETE /api/admin/orgs/:orgKey/objects/:objectApiName  Remove object config
```

**Protect these routes with an admin auth check** (simple API key or future SSO).

### 6.2 Registration flow walkthrough

1. Admin opens GenBI Settings → Org Connections → New Org
2. Fills in form:
   - Label: `myNewOrg`
   - Instance URL: `https://orgfarm-xxx.develop.my.salesforce.com`
   - Login URL: `https://login.salesforce.com` (or sandbox URL)
   - Client ID: consumer key from the GenBI_Local connected app deployed in that org
3. GenBI generates `orgKey` (UUID), stores the org in `sf_orgs` table
4. Admin copies the `orgKey` → pastes into the LWC property in Lightning App Builder

### 6.3 Object Configuration per Org

After registering the org, admin adds object configs:

```json
POST /api/admin/orgs/abc123/objects
{
  "objectApiName": "DCR__c",
  "displayLabel": "Data Change Requests",
  "allowedFields": [
    { "apiName": "Name",              "label": "DCR Name" },
    { "apiName": "Change_Status__c",  "label": "Status" },
    { "apiName": "Submitter__c",      "label": "Submitter" },
    { "apiName": "CreatedDate",       "label": "Created" }
  ],
  "defaultOrderBy": "LastModifiedDate DESC",
  "defaultLimit": "200"
}
```

This replaces the hardcoded `DCR_COLUMNS` array in the current code.
Now each org can expose completely different objects and fields.

---

## Phase 7 — Frontend: Auth Flow + Org-Aware Data

### 7.1 Auth state check on app load

In `artifacts/insurance-dashboard/src/App.tsx`, on mount check if the user has a session:

```typescript
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const orgKey = params.get("orgKey");

  if (!orgKey) return;

  // Check if we have a valid session for this org
  fetch(`/api/sf/auth/status?orgKey=${orgKey}`, { credentials: "include" })
    .then(r => r.json())
    .then(({ authenticated, loginUrl }) => {
      if (!authenticated) {
        // Redirect to SF OAuth — user will be sent back here after login
        window.location.href = loginUrl;
      }
      // else: session exists, dashboard renders normally
    });
}, []);
```

New route to add: `GET /api/sf/auth/status?orgKey=xxx` returns `{ authenticated: bool, loginUrl: string }`.

### 7.2 Org-aware Reports page

Update `artifacts/insurance-dashboard/src/pages/Reports.tsx`:

```typescript
// Before: fetches /api/salesforce/reports/dcr (hardcoded single org)
// After:  reads orgKey from URL params, fetches /api/sf/:orgKey/objects

function Reports() {
  const orgKey = new URLSearchParams(window.location.search).get("orgKey");

  // First: get list of configured objects for this org
  const { data: objects } = useQuery({
    queryKey: ["/api/sf", orgKey, "objects"],
    queryFn: () => fetch(`/api/sf/${orgKey}/objects`, { credentials: "include" }).then(r => r.json()),
    enabled: !!orgKey,
  });

  // Then: fetch data for each configured object
  const { data: objectData } = useQuery({
    queryKey: ["/api/sf", orgKey, "objects", selectedObject],
    queryFn: () => fetch(
      `/api/sf/${orgKey}/objects/${selectedObject}`,
      { credentials: "include" }
    ).then(r => r.json()),
    enabled: !!orgKey && !!selectedObject,
  });

  // Render tabs/tables for each object
}
```

---

## Phase 8 — Security Middleware Stack

Apply these to the Express app in `artifacts/api-server/src/app.ts`:

### 8.1 Security headers (helmet)

```bash
pnpm --filter @workspace/api-server add helmet
```

```typescript
import helmet from "helmet";

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      connectSrc:  ["'self'", "*.salesforce.com", "*.force.com"],
      frameSrc:    ["'none'"],   // GenBI should NOT be iframeable by default
      scriptSrc:   ["'self'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));
```

Note on `frameSrc: 'none'`: if you later decide to embed GenBI inside SF as an iframe, change
this to `["*.salesforce.com", "*.force.com"]` and add the `frame-ancestors` directive.

### 8.2 CORS — only SF domains + the dashboard itself

```typescript
import cors from "cors";

const ALLOWED_ORIGINS = [
  /^https:\/\/.*\.salesforce\.com$/,
  /^https:\/\/.*\.force\.com$/,
  /^https:\/\/.*\.my\.salesforce\.com$/,
  process.env.APP_URL!,
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);  // same-origin / server-to-server
    const ok = ALLOWED_ORIGINS.some(p =>
      typeof p === "string" ? p === origin : p.test(origin)
    );
    cb(ok ? null : new Error("CORS"), ok);
  },
  credentials: true,   // required for session cookies
}));
```

### 8.3 Rate limiting per org

```bash
pnpm --filter @workspace/api-server add express-rate-limit
```

```typescript
import rateLimit from "express-rate-limit";

// Strict limit on auth initiation — prevents OAuth endpoint abuse
app.use("/api/sf/auth/login", rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min window
  max: 10,                    // 10 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
}));

// General API rate limit per session
app.use("/api/sf/", rateLimit({
  windowMs: 60 * 1000,        // 1 min window
  max: 120,                   // 120 data requests per minute per IP
  keyGenerator: (req) => req.session?.sfUserId ?? req.ip ?? "unknown",
}));
```

### 8.4 Audit logging

Every Salesforce data fetch should log: who, which org, which object, how many records, timestamp.

```typescript
// Middleware applied to all /api/sf/:orgKey/objects/* routes
function auditLog(req: Request, _res: Response, next: NextFunction) {
  logger.info({
    event:     "sf_data_access",
    orgKey:    req.session?.orgKey,
    sfUserId:  req.session?.sfUserId,
    object:    req.params.objectName,
    ip:        req.ip,
    userAgent: req.headers["user-agent"],
  });
  next();
}
```

### 8.5 Input validation — no SOQL injection

The `objectName` path param and `allowedFields` come from the **DB config**, never from the user.
The only user-provided input on query routes is `orgKey` (validated as belonging to the session)
and optional filter parameters. Any filter value must be validated against a type-safe allow-list:

```typescript
// Allowed filter operators — never eval or interpolate free text
const ALLOWED_OPERATORS = ["=", "!=", "LIKE", "IN", ">", "<", ">=", "<="] as const;

function buildWhereClause(filters: unknown[]): string {
  if (!Array.isArray(filters) || filters.length === 0) return "";
  // Each filter: { field: "Status__c", op: "=", value: "Active" }
  // field must be in allowedFields for this object — validated before this function
  return "WHERE " + filters
    .filter(f => ALLOWED_OPERATORS.includes((f as {op: string}).op))
    .map(f => `${(f as {field: string}).field} ${(f as {op: string}).op} '${
      String((f as {value: unknown}).value).replace(/'/g, "\\'")  // escape single quotes
    }'`)
    .join(" AND ");
}
```

---

## Phase 9 — Org Registration Admin UI in GenBI

A Settings page in the React dashboard for the GenBI administrator to:
1. Register new Salesforce orgs (paste instanceUrl, loginUrl, clientId)
2. Configure which objects/fields each org can query
3. Copy the `orgKey` UUID to paste into the LWC property in Salesforce App Builder

### New page: `src/pages/OrgAdmin.tsx`

Route: `/settings/orgs`

Sections:
- **Connected Orgs** — table: Label, Instance URL, Objects configured, Last used, Status, Actions (Edit / Deactivate)
- **Add Org** form — Label, Instance URL, Login URL, Client ID
- **Object Config** — per-org: list of configured objects, Add Object button

---

## Complete File Change List

| File | Action | What Changes |
|---|---|---|
| `lib/db/src/schema/sf-orgs.ts` | **Create** | `sf_orgs` table |
| `lib/db/src/schema/sf-user-tokens.ts` | **Create** | `sf_user_tokens` table (per-user per-org tokens) |
| `lib/db/src/schema/sf-org-objects.ts` | **Create** | `sf_org_objects` table (per-org object config) |
| `artifacts/api-server/src/lib/crypto.ts` | **Create** | AES-256-GCM encrypt/decrypt for token columns |
| `artifacts/api-server/src/lib/sf-client.ts` | **Create** | Per-user SF token fetcher + auto-refresh |
| `artifacts/api-server/src/middleware/requireSfAuth.ts` | **Create** | Session guard for all data routes |
| `artifacts/api-server/src/routes/salesforce.ts` | **Replace** | Multi-org, per-user auth + data routes |
| `artifacts/api-server/src/routes/sf-admin.ts` | **Create** | Admin CRUD for orgs + object configs |
| `artifacts/api-server/src/routes/index.ts` | **Update** | Mount `sf-admin` router |
| `artifacts/api-server/src/app.ts` | **Update** | Add helmet, cors, rate-limit, session middleware |
| `artifacts/api-server/src/types/session.d.ts` | **Create** | Session type declaration |
| `artifacts/insurance-dashboard/src/App.tsx` | **Update** | Auth status check + redirect on load |
| `artifacts/insurance-dashboard/src/pages/Reports.tsx` | **Update** | Org-aware, dynamic object tabs |
| `artifacts/insurance-dashboard/src/pages/OrgAdmin.tsx` | **Create** | Admin UI for org registration |
| `artifacts/insurance-dashboard/src/lib/nav-config.ts` | **Update** | Add Org Connections nav entry |
| `salesforce/force-app/main/default/lwc/genbiNavButton/genbiNavButton.html` | **Create** | LWC template |
| `salesforce/force-app/main/default/lwc/genbiNavButton/genbiNavButton.js` | **Create** | LWC controller |
| `salesforce/force-app/main/default/lwc/genbiNavButton/genbiNavButton.js-meta.xml` | **Create** | LWC metadata + configurable `genbiUrl` property |
| `.env.example` | **Update** | Add `TOKEN_ENCRYPTION_KEY` |

---

## Execution Order (implement in this sequence)

```
1. DB schema (Phase 1) → pnpm db:push
2. crypto.ts utility (Phase 1.4)
3. Session middleware in app.ts (Phase 2)
4. Rewrite salesforce.ts (Phase 3) — login route + callback
5. sf-client.ts (Phase 4.1)
6. Data query routes (Phase 4.2–4.3)
7. requireSfAuth middleware (Phase 3.3)
8. sf-admin.ts routes (Phase 6.1)
9. Security middleware: helmet + cors + rate-limit (Phase 8)
10. LWC genbiNavButton (Phase 5) → deploy to each org
11. Frontend auth flow (Phase 7.1)
12. Reports page update (Phase 7.2)
13. OrgAdmin UI page (Phase 9)
```

Steps 1–9 are all backend. Steps 10–13 are frontend + Salesforce. Do them in order because
step 11 depends on the API routes from steps 4–6 existing first.
