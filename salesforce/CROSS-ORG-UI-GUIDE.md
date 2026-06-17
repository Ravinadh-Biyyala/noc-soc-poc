# Cross-Org ownerAssistant — Complete UI Setup Guide

## What We Are Building & Why

The `ownerAssistant` LWC chatbot currently lives in **myNewOrg** and can only query objects
that exist locally in that org (e.g. `DCR__c`). You also have **devOrg**, which contains a
separate object `Data_Change_Request__c`. When a user asks the chatbot about data change
requests, the query currently fails because that object does not exist in myNewOrg.

We are wiring the two orgs together so that:
- The chatbot in myNewOrg knows about both local and external objects.
- When a question targets an external object, the Apex code makes an authenticated HTTP
  call to devOrg's REST API instead of running a local SOQL query.
- Security is maintained: the allow-list (Custom Metadata) and LIMIT cap still apply to
  external calls.

---

## Org Reference

| Role | Alias | Username | Instance URL |
|---|---|---|---|
| Your default / chatbot org | `myNewOrg` | `narasimha.manthena.c4dfef654afb@agentforce.com` | `https://orgfarm-68f60bc547-dev-ed.develop.my.salesforce.com` |
| External / data org | `devOrg` | `khateeja.k.264a2d83ae96@agentforce.com` | `https://orgfarm-e5ac796377-dev-ed.develop.my.salesforce.com` |

---

# PART A — Setup in devOrg

> Log in as `khateeja.k.264a2d83ae96@agentforce.com`
> URL: `https://orgfarm-e5ac796377-dev-ed.develop.my.salesforce.com`

---

## A-1. Create the "GenBI Cross-Org" Connected App

### Why This Is Needed
A **Connected App** is the OAuth 2.0 client registration inside devOrg. It tells devOrg
"I authorise an external application to call my REST API on behalf of a specific user."
Without it, myNewOrg cannot obtain an access token to read devOrg's records.

We enable the **Client Credentials** grant type, which is a machine-to-machine flow —
no human login popup needed at runtime. The app runs as a designated API user
(`khateeja.k.264a2d83ae96@agentforce.com`), so all queries execute with that user's
permissions and sharing rules.

### Steps

1. Click the **gear icon** (top-right) → **Setup**.
2. In the Quick Find box (left side) type `App Manager` → click **App Manager**.
3. Click **New Connected App** (top-right button).

**Basic Information section:**
| Field | Value |
|---|---|
| Connected App Name | `GenBI Cross-Org` |
| API Name | `GenBI_Cross_Org` (auto-fills) |
| Contact Email | `khateeja.k.264a2d83ae96@agentforce.com` |
| Description | `Allows myNewOrg ownerAssistant to query this org via OAuth Client Credentials` |

4. Scroll to **API (Enable OAuth Settings)** → tick **Enable OAuth Settings**.

**OAuth Settings:**
| Field | Value / Action |
|---|---|
| Callback URL | `https://login.salesforce.com/services/oauth2/success` |
| Use digital signatures | Leave unchecked |
| Selected OAuth Scopes | Move **Access the identity URL service (id, profile, email, address, phone)** and **Manage user data via APIs (api)** to *Selected* |

5. Scroll to **Enable Client Credentials Flow** section:
   - Tick **Enable Client Credentials Flow**.
   - A new field appears: **Run As** → click the lookup icon → search for
     `khateeja` → select `khateeja.k.264a2d83ae96@agentforce.com`.

   > **Why "Run As"?** Client Credentials is app-to-app with no interactive user.
   > Salesforce needs to know *which user's permissions* to enforce on every API call.
   > Using the org owner's account means the caller gets full API access to
   > `Data_Change_Request__c` and any other objects that user can see.

6. Leave all other defaults. Click **Save** → **Continue**.

---

## A-2. Copy the Consumer Key and Secret

You will need these in Part B.

1. After saving, you land on the app detail page. Click **Manage Consumer Details**
   (you may need to verify your identity / enter a code).
2. You will see:
   - **Consumer Key** (a long string like `3MVG9...`)
   - **Consumer Secret** (click **Click to reveal**)
3. Copy both values to a text file. You will paste them into myNewOrg.

---

## A-3. Verify the Connected App Is Active

1. From App Manager, find **GenBI Cross-Org** → click the dropdown arrow → **Manage**.
2. Under **OAuth Policies**:
   - **Permitted Users** → set to **All users may self-authorize** (or **Admin approved users are pre-authorized** if you want tighter control).
   - **IP Relaxation** → **Relax IP restrictions** (for dev orgs this is fine).
3. Click **Save**.

---

## A-4. Grant API Access via Permission Set (if needed)

If the "Run As" user (`khateeja`) does not have API access, callouts will return 403.

1. Quick Find → **Permission Sets** → click the permission set assigned to that user
   (e.g. `Data_Change_Request__c` object permissions).
2. Under **System Permissions** ensure **API Enabled** is ticked.
3. Click **Save**.

---

# PART B — Setup in myNewOrg

> Log in as `narasimha.manthena.c4dfef654afb@agentforce.com`
> URL: `https://orgfarm-68f60bc547-dev-ed.develop.my.salesforce.com`

---

## B-1. Add Two Fields to the "Owner Assistant Object" Custom Metadata Type

### Why This Is Needed
The `Owner_Assistant_Object__mdt` Custom Metadata Type is the **allow-list** that tells the
chatbot which objects and fields it may query. Currently it has no way to express "this
object is in a different org." We add two fields:

- **Is External Org** (`Is_External__c`) — a checkbox. When ticked, the Apex code routes
  the query to `ExternalOrgQueryService` (HTTP callout) instead of a local SOQL.
- **External Named Credential** (`External_Named_Credential__c`) — a text field that holds
  the developer name of the Named Credential to use for that callout. This keeps the
  configuration data-driven: you can add more external orgs by adding more CMT records,
  each pointing to a different Named Credential.

### Steps — Field 1: Is External Org

1. Quick Find → **Custom Metadata Types** → next to **Owner Assistant Object** click **Manage**.

   > You see the existing records (DCR, Contact, Account, etc.).

2. Click **Back** (or use the breadcrumb) to return to the CMT definition page. You need
   the **Fields** section of the type itself, not the records.

   Alternative path: Quick Find → **Custom Metadata Types** → click **Owner Assistant Object**
   (the type name link, not "Manage").

3. Scroll to **Custom Fields** → click **New**.

4. Select field type: **Checkbox** → **Next**.

| Field | Value |
|---|---|
| Field Label | `Is External Org` |
| Field Name | `Is_External` (API name becomes `Is_External__c`) |
| Default Value | **Unchecked** |
| Description | `When checked, queries for this object are routed to the external org via Named Credential callout instead of local SOQL.` |

5. Click **Next** → **Next** → **Save**.

### Steps — Field 2: External Named Credential

1. On the same Owner Assistant Object type page → **Custom Fields** → **New**.
2. Select field type: **Text** → **Next**.

| Field | Value |
|---|---|
| Field Label | `External Named Credential` |
| Field Name | `External_Named_Credential` (API name: `External_Named_Credential__c`) |
| Length | `255` |
| Description | `Developer name of the Named Credential to use when Is External Org is checked (e.g. DevOrg_NC). Leave blank for local objects.` |

3. Click **Next** → **Next** → **Save**.

---

## B-2. Update the "Data Change Request" CMT Record

### Why This Is Needed
The existing CMT record for `Data_Change_Request__c` in myNewOrg was created as a test
entry pointing to a local object that doesn't actually exist in this org. We need to
flip it to **external** and point it at the Named Credential we are about to create.

### Steps

1. Quick Find → **Custom Metadata Types** → next to **Owner Assistant Object** click **Manage**.
2. Find the record labeled **Data Change Request (test)** → click **Edit**.
3. Update these fields:

| Field | Old Value | New Value |
|---|---|---|
| Label | `Data Change Request (test)` | `Data Change Request` |
| Object API Name | `Data_Change_Request__c` | `Data_Change_Request__c` *(unchanged)* |
| Owner Scope Field | `Target_Property__c` | *(clear this field — leave blank)* |
| Allowed Fields | *(existing)* | `Id, Name, Target_Property__c, Submitter__c, CreatedDate, LastModifiedDate` |
| Description | *(existing)* | `Data change requests from the external devOrg system` |
| Is Active | ✓ | ✓ *(keep checked)* |
| **Is External Org** | *(new field)* | **✓ Check this** |
| **External Named Credential** | *(new field)* | `DevOrg_NC` |

   > **Why clear Owner Scope Field?**  
   > The owner scope predicate (`WHERE Source_Owner_Id__c = :ownerScopeId`) is a local-org
   > concept. `Target_Property__c` in devOrg is a Salesforce ID that has no relationship
   > to the current user's account in myNewOrg. Leaving it blank means the Apex code
   > (updated `SoqlGuard`) skips scope injection for external objects entirely.

4. Click **Save**.

---

## B-3. Create the Auth Provider for devOrg

### Why This Is Needed
An **Auth Provider** tells myNewOrg how to speak OAuth 2.0 with a specific identity
provider — in this case, devOrg itself. It stores the token endpoint URL, the consumer
key, and (after manual entry) the consumer secret. The Named Credential (next step) then
references this Auth Provider so it knows how to get and refresh access tokens
automatically.

Salesforce provides a built-in **Salesforce** Auth Provider type specifically for
org-to-org OAuth. It handles token refresh transparently so the Apex callout never
encounters an expired-token error.

### Steps

1. Quick Find → **Auth. Providers** → **New**.
2. For **Provider Type** select **Salesforce**.

| Field | Value |
|---|---|
| Name | `DevOrg Org-to-Org` |
| URL Suffix | `devorg` *(auto-fills, used in callback URL)* |
| Consumer Key | *(paste the Consumer Key you copied from devOrg in step A-2)* |
| Consumer Secret | *(paste the Consumer Secret from step A-2)* |
| Authorize Endpoint URL | `https://orgfarm-e5ac796377-dev-ed.develop.my.salesforce.com/services/oauth2/authorize` |
| Token Endpoint URL | `https://orgfarm-e5ac796377-dev-ed.develop.my.salesforce.com/services/oauth2/token` |
| User Info Endpoint URL | `https://orgfarm-e5ac796377-dev-ed.develop.my.salesforce.com/services/oauth2/userinfo` |
| Default Scopes | `api` |
| Send access token in header | ✓ *(checked)* |
| Send client credentials in header | Leave unchecked |

3. Click **Save**.

   > Salesforce generates a **Callback URL** for this Auth Provider (something like
   > `https://orgfarm-68f60bc547-dev-ed.develop.my.salesforce.com/services/authcallback/devorg`).
   > **Copy this URL** — you will need it in the next step.

---

## B-4. Add the Callback URL back to devOrg's Connected App

### Why This Is Needed
OAuth requires that the redirect after authorization goes to a pre-registered URL. When
myNewOrg's Named Credential first authenticates, devOrg will redirect back to myNewOrg's
Auth Provider callback URL. devOrg must know this URL in advance (whitelist it).

### Steps

1. **Switch back to devOrg** → Setup → App Manager → **GenBI Cross-Org** → **Edit**.
2. Under **Callback URL**, add a new line with the callback URL you copied in B-3.
   (It looks like: `https://orgfarm-68f60bc547-dev-ed.develop.my.salesforce.com/services/authcallback/devorg`)
3. Click **Save**.
4. **Switch back to myNewOrg**.

---

## B-5. Create the Named Credential (DevOrg_NC)

### Why This Is Needed
A **Named Credential** is the secure envelope that Apex uses for HTTP callouts. Instead of
hardcoding a URL or token in code, Apex says `callout:DevOrg_NC/services/data/v64.0/query`
and Salesforce automatically:
- Resolves the endpoint to `https://orgfarm-e5ac796377-dev-ed.develop.my.salesforce.com`
- Attaches a valid `Authorization: Bearer <token>` header
- Refreshes the token when it expires using the Auth Provider

This means no credentials ever appear in Apex code or logs.

The **Named Principal** principal type means the token is org-wide (one shared token for
all callouts), not per-user. This is appropriate here because the chatbot queries
enterprise data, not personal data belonging to the individual running the LWC.

### Steps

1. Quick Find → **Named Credentials** → **New Legacy** (important: use *Legacy*, not the
   newer External Credentials flow — the legacy format works directly with Auth Providers).

| Field | Value |
|---|---|
| Label | `DevOrg` |
| Name | `DevOrg_NC` *(API / developer name used in Apex: `callout:DevOrg_NC`)* |
| URL | `https://orgfarm-e5ac796377-dev-ed.develop.my.salesforce.com` |
| Identity Type | **Named Principal** |
| Authentication Protocol | **OAuth 2.0** |
| Authentication Provider | `DevOrg Org-to-Org` *(the one you just created)* |
| Scope | `api` |
| Generate Authorization Header | ✓ *(checked)* |
| Allow Merge Fields in HTTP Header | Leave unchecked |
| Allow Merge Fields in HTTP Body | Leave unchecked |

2. Click **Save**.

---

## B-6. Authorize the Named Credential (one-time OAuth flow)

### Why This Is Needed
The Named Credential stores a **Named Principal** token — one token shared by all Apex
callouts. Before any callout can work, an admin must perform a one-time OAuth flow to
obtain that token. After this, Salesforce handles refresh automatically forever.

### Steps

1. You should now be on the Named Credential detail page for **DevOrg**.
2. Click **Edit** → scroll to the bottom → under *Authentication Status* click
   **Edit Credentials** (or **Authenticate**).
3. A popup opens and redirects to devOrg's login page.
4. Sign in with `khateeja.k.264a2d83ae96@agentforce.com`.
5. On the OAuth authorization screen click **Allow**.
6. You are redirected back to myNewOrg. The Named Credential now shows
   **Authenticated as: khateeja.k.264a2d83ae96@agentforce.com**.

---

## B-7. Create the Remote Site Setting for devOrg

### Why This Is Needed
Salesforce blocks all outbound HTTP callouts by default — even when using Named
Credentials — unless the target domain is listed in Remote Site Settings. This is a
security control that prevents Apex code from accidentally leaking data to unknown URLs.

Named Credentials technically handle this for `callout:` endpoints, but adding a Remote
Site Setting provides belt-and-suspenders protection and is required if you ever make
direct HTTP callouts (without the Named Credential prefix) for debugging or testing.

### Steps

1. Quick Find → **Remote Site Settings** → **New Remote Site**.

| Field | Value |
|---|---|
| Remote Site Name | `DevOrg_RS` |
| Remote Site URL | `https://orgfarm-e5ac796377-dev-ed.develop.my.salesforce.com` |
| Description | `Allows Apex callouts to devOrg for cross-org SOQL queries via ExternalOrgQueryService` |
| Active | ✓ *(checked)* |
| Disable Protocol Security | Leave unchecked |

2. Click **Save**.

---

## B-8. Deploy the New and Updated Apex Classes

### Why This Is Needed

Four Apex classes need to be in myNewOrg:

| Class | What Changed / Why |
|---|---|
| `ExternalOrgQueryService` | **Brand new.** Makes `callout:DevOrg_NC/services/data/v64.0/query?q=<soql>` and returns data in the same shape as `SoqlExecutor.QueryResult`. |
| `SchemaCatalogService` | **Updated.** Now reads the two new CMT fields (`Is_External__c`, `External_Named_Credential__c`) and adds them to `ObjectMeta`. Also annotates the LLM schema doc with `[external org]` so the AI knows the object lives elsewhere. |
| `SoqlGuard` | **Updated.** When the object is external, skips the owner-scope predicate injection (the scope field is local and meaningless cross-org). Carries `isExternal` and `externalNamedCredential` in the `GuardResult` so `OwnerChatController` knows what to do next. |
| `OwnerChatController` | **Updated.** After `SoqlGuard.sanitize()`, checks `guard.isExternal`. If true, calls `ExternalOrgQueryService.run(guard.soql, guard.externalNamedCredential)` instead of `SoqlExecutor.run()`. |

The existing class files have already been written to the local repo. Deploy them to
myNewOrg using the Salesforce CLI:

```bash
# From the repo root:

# Deploy ExternalOrgQueryService (new class)
sf project deploy start \
  --source-dir "salesforce/force-app/main/default/classes/ExternalOrgQueryService.cls" \
  --source-dir "salesforce/force-app/main/default/classes/ExternalOrgQueryService.cls-meta.xml" \
  --target-org myNewOrg

# Deploy updated classes
sf project deploy start \
  --source-dir "salesforce/force-app/main/default/classes/SchemaCatalogService.cls" \
  --source-dir "salesforce/force-app/main/default/classes/SchemaCatalogService.cls-meta.xml" \
  --source-dir "salesforce/force-app/main/default/classes/SoqlGuard.cls" \
  --source-dir "salesforce/force-app/main/default/classes/SoqlGuard.cls-meta.xml" \
  --source-dir "salesforce/force-app/main/default/classes/OwnerChatController.cls" \
  --source-dir "salesforce/force-app/main/default/classes/OwnerChatController.cls-meta.xml" \
  --target-org myNewOrg
```

Or deploy all four at once using Developer Console (paste each class body):

### Using Developer Console (no CLI needed)

1. In myNewOrg: click the **gear icon** → **Developer Console**.
2. **File → New → Apex Class** → name it `ExternalOrgQueryService` → paste the full
   class body from
   `salesforce/force-app/main/default/classes/ExternalOrgQueryService.cls` → **Save (Ctrl+S)**.
3. Repeat for `SchemaCatalogService` (overwrite existing), `SoqlGuard` (overwrite), and
   `OwnerChatController` (overwrite).

   > To overwrite an existing class: **File → Open → Classes → [ClassName]** → select all
   > text → paste the new body → **Save**.

---

## B-9. Grant ExternalOrgQueryService Callout Permission (if Org has strict CSP)

### Why This Is Needed
In some orgs, Apex HTTP callouts must be explicitly allowed for specific classes via CSP
Trusted Sites or via the Named Credential itself. In most Developer Edition orgs this is
automatic once the Named Credential and Remote Site Setting exist.

If you see a `System.CalloutException: Unauthorized endpoint` error after deployment,
go to:

1. Quick Find → **CSP Trusted Sites** → **New Trusted Site**.

| Field | Value |
|---|---|
| Trusted Site Name | `DevOrg_CSP` |
| Trusted Site URL | `https://orgfarm-e5ac796377-dev-ed.develop.my.salesforce.com` |
| Context | **All** (or specifically **Visualforce / LWC** if available) |
| Active | ✓ |

2. Click **Save**.

---

## B-10. Verify Everything Works End-to-End

### Step 1 — Confirm CMT record is correct

1. Quick Find → **Custom Metadata Types** → **Owner Assistant Object** → **Manage**.
2. Find **Data Change Request** → click **View**.
3. Confirm:
   - `Is External Org` = **Checked**
   - `External Named Credential` = `DevOrg_NC`
   - `Is Active` = **Checked**

### Step 2 — Test with Anonymous Apex

1. In myNewOrg → **Developer Console** → **Debug → Open Execute Anonymous Window**.
2. Paste and run:

```apex
// Confirm the catalog sees Data_Change_Request__c as external
Map<String, SchemaCatalogService.ObjectMeta> catalog = SchemaCatalogService.getCatalog();
SchemaCatalogService.ObjectMeta meta = catalog.get('data_change_request__c');
System.debug('Found: ' + (meta != null));
System.debug('isExternal: ' + meta.isExternal);
System.debug('namedCredential: ' + meta.externalNamedCredential);
```

   Expected output in Logs:
   ```
   Found: true
   isExternal: true
   namedCredential: DevOrg_NC
   ```

### Step 3 — Test the actual callout

```apex
// Run a direct callout to devOrg — only works after B-6 authorization
SoqlExecutor.QueryResult result = ExternalOrgQueryService.run(
    'SELECT Id, Name, CreatedDate FROM Data_Change_Request__c LIMIT 5',
    'DevOrg_NC'
);
System.debug('Records from devOrg: ' + result.size);
System.debug('Columns: ' + result.columns);
```

   Expected: `Records from devOrg: 2` (or however many records exist).

### Step 4 — Ask the ownerAssistant chatbot

Open the ownerAssistant LWC (in the Experience Site or wherever it's placed) and ask:

> "Show me the data change requests from the external system"
> "How many data change requests are there?"
> "List all change requests with their submitter"

The chatbot should return a table of records from devOrg's `Data_Change_Request__c`.

---

## Full Flow Diagram (What Happens at Runtime)

```
User types: "Show me data change requests"
           │
           ▼
OwnerChatController.askQuestion()
  │
  ├── OwnerContextService.getOwnerScope()
  │     └── Resolves running user's Contact → AccountId  [myNewOrg]
  │
  ├── SchemaCatalogService.getCatalog()
  │     └── Reads Owner_Assistant_Object__mdt WHERE Is_Active = true
  │           Returns catalog including:
  │             "data_change_request__c" → {isExternal: true, namedCredential: "DevOrg_NC"}
  │
  ├── SchemaCatalogService.buildSchemaDoc()
  │     └── Generates: "OBJECT Data_Change_Request__c [external org] — ..."
  │           (LLM sees [external org] tag, knows it must use that object name)
  │
  ├── LlmService.generateSoql()
  │     └── GPT produces: "SELECT Id, Name, Submitter__c FROM Data_Change_Request__c LIMIT 200"
  │
  ├── SoqlGuard.sanitize()
  │     ├── Validates: SELECT only, no DML, no subqueries, FROM object in allow-list ✓
  │     ├── Detects: meta.isExternal = true → SKIPS owner scope injection
  │     ├── Enforces: LIMIT 200
  │     └── Returns: GuardResult { soql: "SELECT...", isExternal: true, namedCredential: "DevOrg_NC" }
  │
  ├── guard.isExternal? YES
  │     │
  │     └── ExternalOrgQueryService.run("SELECT...", "DevOrg_NC")
  │           │
  │           ├── HttpRequest to:
  │           │   callout:DevOrg_NC/services/data/v64.0/query?q=SELECT+Id%2C+Name...
  │           │   (Salesforce auto-attaches "Authorization: Bearer <devOrg token>")
  │           │
  │           ├── devOrg REST API executes:
  │           │   SELECT Id, Name, Submitter__c FROM Data_Change_Request__c LIMIT 200
  │           │   as user: khateeja.k.264a2d83ae96@agentforce.com
  │           │
  │           └── Returns QueryResult { rows: [...], columns: [...], size: 2 }
  │
  └── LlmService.composeAnswer()
        └── GPT writes natural language answer based on the rows JSON
              "There are 2 data change requests: ..."
```

---

## Troubleshooting Reference

| Error / Symptom | Root Cause | Fix |
|---|---|---|
| `I am not able to access that information` | CMT record missing or `Is_Active__c = false` | Check B-2: Is Active must be ticked |
| `External org is not configured` | `External_Named_Credential__c` is blank on CMT record | Check B-2: field must contain `DevOrg_NC` |
| `CALLOUT_FAILED` or `System.CalloutException` | Named Credential not authorized | Redo step B-6 (Edit Credentials) |
| HTTP 401 from devOrg | Consumer key/secret wrong, or token expired | Check B-3 Auth Provider credentials; redo B-6 |
| HTTP 400 `INVALID_FIELD` | Allowed_Fields on CMT doesn't match actual devOrg field names | Check B-2 Allowed Fields list against actual devOrg object schema |
| HTTP 403 `API_DISABLED_FOR_ORG` or `REQUEST_LIMIT_EXCEEDED` | devOrg API access not enabled | Check A-4: API Enabled permission |
| Named Credential shows "Not Authenticated" | One-time flow in B-6 was never completed | Click Edit → Authenticate in Named Credential Setup |
| `No such column 'Is_External__c'` on CMT query | CMT fields not yet added | Complete step B-1 |
| Chatbot answers but returns empty data | Records exist but scope field was left set | B-2: clear Owner Scope Field for external objects |
