# Cross-Org ownerAssistant Setup

Enables the ownerAssistant LWC in **myNewOrg** to query `Data_Change_Request__c`
records that live in **devOrg** — two connected Salesforce orgs with separate data.

## Architecture

```
User asks a question
       │
 OwnerChatController (myNewOrg)
       │
 SchemaCatalogService reads CMT
       │  Is_External__c = true?
       ├─── NO  → SoqlExecutor (local DATABASE.queryWithBinds)
       └─── YES → ExternalOrgQueryService
                       │  callout:DevOrg_NC/services/data/v64.0/query
                       └─── devOrg REST API → Data_Change_Request__c
```

---

## Step 1 — Deploy Connected App to devOrg

```bash
sf project deploy start \
  --source-dir salesforce/force-app/main/default/connectedApps/GenBI_CrossOrg.connectedApp-meta.xml \
  --target-org devOrg
```

Then open devOrg Setup and copy the consumer key + secret:

- **Setup → Apps → App Manager → GenBI Cross-Org → View**
- Note down **Consumer Key** and **Consumer Secret**

---

## Step 2 — Deploy CMT fields + Remote Site to myNewOrg

```bash
sf project deploy start \
  --source-dir salesforce/force-app/main/default/objects/Owner_Assistant_Object__mdt \
  --source-dir salesforce/force-app/main/default/remoteSiteSettings/DevOrg_RS.remoteSite-meta.xml \
  --target-org myNewOrg
```

---

## Step 3 — Deploy Auth Provider to myNewOrg

> **Before this step:** open
> `salesforce/force-app/main/default/authProviders/DevOrg_AuthProvider.authprovider-meta.xml`
> and replace `REPLACE_WITH_DEVORG_CONSUMER_KEY` with the real consumer key from Step 1.

```bash
sf project deploy start \
  --source-dir salesforce/force-app/main/default/authProviders/DevOrg_AuthProvider.authprovider-meta.xml \
  --target-org myNewOrg
```

Then enter the consumer secret:
- **myNewOrg Setup → Identity → Auth. Providers → DevOrg Org-to-Org → Edit**
- Paste **Consumer Secret** from Step 1 → **Save**

---

## Step 4 — Deploy Named Credential to myNewOrg

```bash
sf project deploy start \
  --source-dir salesforce/force-app/main/default/namedCredentials/DevOrg_NC.namedCredential-meta.xml \
  --target-org myNewOrg
```

Then authorize the Named Credential so Apex can use it:
- **myNewOrg Setup → Security → Named Credentials → DevOrg → Edit**
- Under *Authentication* click **Edit Credentials**
- Salesforce redirects to devOrg login — sign in with
  `khateeja.k.264a2d83ae96@agentforce.com`
- After authorize, you are redirected back. The Named Credential now holds
  a valid OAuth token for org-wide callouts.

---

## Step 5 — Deploy Apex + CMT record to myNewOrg

```bash
sf project deploy start \
  --source-dir salesforce/force-app/main/default/classes/ExternalOrgQueryService.cls \
  --source-dir salesforce/force-app/main/default/classes/ExternalOrgQueryService.cls-meta.xml \
  --source-dir salesforce/force-app/main/default/classes/SchemaCatalogService.cls \
  --source-dir salesforce/force-app/main/default/classes/SchemaCatalogService.cls-meta.xml \
  --source-dir salesforce/force-app/main/default/classes/SoqlGuard.cls \
  --source-dir salesforce/force-app/main/default/classes/SoqlGuard.cls-meta.xml \
  --source-dir salesforce/force-app/main/default/classes/OwnerChatController.cls \
  --source-dir salesforce/force-app/main/default/classes/OwnerChatController.cls-meta.xml \
  --source-dir salesforce/force-app/main/default/customMetadata/Owner_Assistant_Object.Data_Change_Request.md-meta.xml \
  --target-org myNewOrg
```

Or deploy everything in one shot:

```bash
sf project deploy start \
  --source-dir salesforce/force-app \
  --target-org myNewOrg
```

> Note: the `GenBI_CrossOrg.connectedApp-meta.xml` in the same tree won't break
> a deploy to myNewOrg — Salesforce ignores Connected Apps that already exist
> or creates a harmless duplicate. To keep things clean, exclude it:
> `--ignore-conflicts` or deploy each directory individually.

---

## Step 6 — Verify

Open the ownerAssistant in myNewOrg and ask:

> "Show me the latest data change requests from the external system"

The assistant should:
1. Generate SOQL against `Data_Change_Request__c`
2. Route to `ExternalOrgQueryService` (visible in debug logs as `callout:DevOrg_NC`)
3. Return records from devOrg in the chat response

To confirm in logs:
```bash
sf apex tail log --target-org myNewOrg
```
Look for `ExternalOrgQueryService: callout` entries.

---

## What changed

| File | Change |
|---|---|
| `connectedApps/GenBI_CrossOrg.connectedApp-meta.xml` | New — deploy to **devOrg** |
| `objects/Owner_Assistant_Object__mdt/fields/Is_External__c.field-meta.xml` | New CMT field |
| `objects/Owner_Assistant_Object__mdt/fields/External_Named_Credential__c.field-meta.xml` | New CMT field |
| `authProviders/DevOrg_AuthProvider.authprovider-meta.xml` | New — Salesforce-type Auth Provider |
| `namedCredentials/DevOrg_NC.namedCredential-meta.xml` | New — Named Principal OAuth credential |
| `remoteSiteSettings/DevOrg_RS.remoteSite-meta.xml` | New — allow callouts to devOrg |
| `classes/ExternalOrgQueryService.cls` | **New** — REST API callout to external org |
| `classes/SchemaCatalogService.cls` | Updated — reads `Is_External__c`, `External_Named_Credential__c` |
| `classes/SoqlGuard.cls` | Updated — skips scope injection for external objects; adds `isExternal` + `externalNamedCredential` to `GuardResult` |
| `classes/OwnerChatController.cls` | Updated — routes to `ExternalOrgQueryService` when `guard.isExternal` |
| `customMetadata/Owner_Assistant_Object.Data_Change_Request.md-meta.xml` | Updated — sets `Is_External__c = true`, `External_Named_Credential__c = DevOrg_NC` |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `CALLOUT_FAILED` on devOrg URL | Named Credential token expired → re-authorize in Setup (Step 4) |
| `I am not able to access that information` | CMT record not deployed or `Is_Active__c = false` |
| `External org is not configured` | `External_Named_Credential__c` is blank on the CMT record |
| HTTP 401 from devOrg | Named Credential OAuth credentials invalid; re-enter consumer key/secret |
| HTTP 400 INVALID_FIELD | Field not in `Allowed_Fields__c` on the CMT record |
