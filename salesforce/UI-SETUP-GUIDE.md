# Building It All in the Salesforce UI (point‑and‑click)

Everything we created from the CLI this session, reproduced as Setup clicks. Do the
sections **top to bottom** — later steps depend on earlier ones.

> Legend: **Setup** = the gear icon (top‑right) → *Setup*. "Quick Find" = the search box
> on the left of Setup.

| # | What we did in CLI | Where in the UI |
|---|---|---|
| 1 | Create `DCR__c` object | Object Manager |
| 2 | Add fields | Object Manager → Fields & Relationships |
| 3 | Tab for the object | Setup → Tabs |
| 4 | Import 200 records | Data Import Wizard / Data Loader |
| 5 | `DCR_Access` permission set + assign | Setup → Permission Sets |
| 6 | Enable + create the Experience site | Setup → Digital Experiences |
| 7 | Place component, nav, publish | Experience Builder |
| 8 | Owner Assistant feature config | see `owner-assistant/docs/MANUAL-SETUP-UI.md` |
| 9 | Allow‑list `DCR__c` for the assistant | Custom Metadata Types |
| 10 | OpenAI key | Custom Settings |

---

## 1. Create the custom object `DCR__c`
CLI did: deployed `objects/DCR__c/DCR__c.object-meta.xml`.

1. **Setup → Object Manager** (top tab) → **Create ▾ → Custom Object**.
2. Label: `DCR`, Plural: `DCRs`. Object Name auto‑fills `DCR` (API name becomes `DCR__c`).
3. Record Name: `DCR Name`, Data Type: **Text**.
4. Tick **Allow Reports**, **Allow Search**, **Allow Activities** (optional).
5. (Optional) tick *Launch New Custom Tab Wizard* to do step 3 in one go.
6. **Save.**

---

## 2. Add the fields
CLI did: generated 256 `field-meta.xml` files + `Source_Owner_Id__c`.

**One field, the pattern:**
1. **Object Manager → DCR → Fields & Relationships → New**.
2. Pick the type:
   - text columns → **Text**, length `255`
   - the TRUE/FALSE columns → **Checkbox**, default *Unchecked*
   - `Source_Owner_Id__c` → **Text**, length `18`
3. Label (e.g. `Change Status`) → Field Name auto‑fills (`Change_Status`).
4. **Next** → set field‑level security (which profiles see it) → **Next** → choose page layouts → **Save**.

> ⚠️ Reality check: **256 fields by hand is not practical** — that's 256 trips through this
> wizard. This is exactly *why* the CLI/metadata approach exists. In the UI the realistic
> path for that many fields is **Data Loader** + a metadata tool, or just keep the CLI deploy.
> Do 2–3 by hand to learn the wizard, then let the deploy handle the rest.

---

## 3. Create a tab (so the object shows in the UI)
1. **Setup → Quick Find: `Tabs` → Custom Object Tabs → New**.
2. Object: **DCR**, pick a tab style (icon), **Next → Next → Save**.
3. Open the **App Launcher** (waffle, top‑left) → search **DCR** → you'll see the list view.

---

## 4. Import the 200 records
CLI did: `sf data import bulk --file dcr_import.csv --sobject DCR__c`.

**Option A – Data Import Wizard (in‑browser, easiest):**
1. **Setup → Quick Find: `Data Import Wizard` → Launch Wizard**.
2. **Custom objects → DCR** → **Add new records**.
3. Upload `dcr_import.csv` (the cleaned file we generated). Set character encoding UTF‑8, comma‑delimited.
4. **Map fields** — match each CSV column to the DCR field (the wizard auto‑maps exact names).
5. **Start Import.** Watch progress under **Setup → Bulk Data Load Jobs**.

> The Wizard caps at **50,000 records** and won't set system fields — fine here.

**Option B – Data Loader (desktop app, what pros use):**
1. Download from **Setup → Quick Find: `Data Loader`** (or developer.salesforce.com).
2. Open it → **Insert** → log in (OAuth) → choose object **DCR** (tick *Show all Salesforce objects* if custom).
3. Browse to `dcr_import.csv` → **Next** → **Create or Edit Map** (auto‑match) → **Next** → **Finish**.
4. It writes `success` / `error` CSVs next to your file.

---

## 5. Permission set `DCR_Access` (+ assign yourself)
CLI did: deployed `DCR_Access.permissionset-meta.xml` then `sf org assign permset`.

1. **Setup → Quick Find: `Permission Sets` → New**. Label `DCR Access` → **Save**.
2. **Object Settings → DCR** → **Edit** → tick **Read, Create, Edit, Delete** (and *View All* / *Modify All* if you want) → under *Field Permissions* tick **Read/Edit** on the fields → **Save**.
3. **Manage Assignments → Add Assignment** → tick your user → **Assign → Done**.

> The UI sets field‑level security here, on the *Object Settings* screen — that's the same
> `<fieldPermissions>` the CLI permission set carried. (This is what fixed the earlier
> "field not found" bulk error — new fields are invisible until a profile/permset grants FLS.)

---

## 6. Enable Digital Experiences + create the site
CLI did: `sf community create --name "Owners Portal" --template-name "Build Your Own (LWR)"`.

1. **Setup → Quick Find: `Digital Experiences` → Settings** → tick **Enable Digital Experiences** → pick a domain → **Save**. (One‑time per org.)
2. **Digital Experiences → All Sites → New**.
3. Choose template **Build Your Own (LWR)** → **Get Started**.
4. Name `Owners Portal`, URL path `owners` → **Create**. (Salesforce builds it in ~1 min.)

---

## 7. Experience Builder: component + navigation + publish
CLI did: edited the bundle's `home` view, nav menu, and `sf community publish`.

1. **All Sites → (Owners Portal) → Builder.**
2. On the **Home** page, delete the placeholder text component, then from the left
   **Components** panel (under *Custom*) drag **Owners Portal Home** onto the page region.
   - (Set *Owner First Name* / *Profile Strength* in the right‑hand properties if you want.)
3. **Add a real Reports page** (the one metadata couldn't create — *this* is the UI‑only step):
   - Top bar **Pages ▾ → + New Page → Standard Page** → name `Reports`, URL `reports` → **Create**.
   - Drag the **Owner Assistant** component onto it.
4. **Navigation menu:** click the site **Navigation** component (or **Settings → Navigation**) →
   **Add Menu Item** → Name `Reports`, Type **Site Page → Reports** → **Save**.
5. **Publish** (top‑right) → **Got it**. Then **Setup → All Sites → Activate** to make it live.

> LWC components (`Owners Portal Home`, `Owner Assistant`) themselves **cannot** be created in
> Setup — they need VS Code/Code Builder + a deploy. Everything *around* them (placing,
> nav, publish) is UI.

---

## 8. The Owner Assistant feature (Apex + config)
The full point‑and‑click for the assistant's classes, custom setting, remote site, custom
permissions, permission sets and Dev Mode is already written up in:

**`salesforce/owner-assistant/docs/MANUAL-SETUP-UI.md`** — follow its sections 1–8.

Key pieces and where they live:
| Piece | UI location |
|---|---|
| Apex classes (`OwnerChatController`, `SoqlGuard`, …) | **Developer Console → File → New → Apex Class** (paste each `.cls`) |
| LWC (`ownerAssistant`) | Not in Setup — Code Builder/VS Code + deploy |
| Custom permissions (`Owner_Assistant_Dev_Mode`, `_Debug`) | **Setup → Custom Permissions → New** |
| Permission set `Owner Assistant Dev Test` (Dev Mode bypass) | **Setup → Permission Sets** → add the two custom permissions + Apex class access → assign |
| Remote Site `OpenAI` (`https://api.openai.com`) | **Setup → Remote Site Settings → New Remote Site** |

> **"Why Dev Mode?"** Assigning the *Owner Assistant Dev Test* permission set gives you the
> `Owner_Assistant_Dev_Mode` custom permission, which lets a non‑owner (you) use the chat —
> that's the UI equivalent of `sf org assign permset --name Owner_Assistant_DevTest`.

---

## 9. Allow‑list `DCR__c` for the assistant (Custom Metadata)
CLI did: deployed `customMetadata/Owner_Assistant_Object.DCR.md-meta.xml`.

1. **Setup → Quick Find: `Custom Metadata Types`** → next to **Owner Assistant Object** click **Manage Records → New**.
2. Fill:
   - **Label:** `DCR`
   - **Object API Name:** `DCR__c`
   - **Owner Scope Field:** `Source_Owner_Id__c`
   - **Allowed Fields:** `Id, Name, Source_Owner_Id__c, Change_Status__c, Change_Source__c, Date_of_Approval__c, Hilton_ID__c, Eligible__c, CreatedDate`
   - **Description:** *Owner data change requests…*
   - **Is Active:** ✓
3. **Save.** (The assistant reads active records here to know what it may query.)

---

## 10. Set the OpenAI key (the only paid piece)
CLI did: `Owner_Assistant_Settings__c.OpenAI_API_Key__c` via Apex.

1. **Setup → Quick Find: `Custom Settings`** → next to **Owner Assistant Settings** click **Manage**.
2. Click **New** (above *Default Organization Level Value*).
3. Paste your OpenAI key into **OpenAI API Key** → **Save**.

> Free for learning: skip this and everything except the chat's AI answer still works.

---

### What is genuinely UI‑impossible (needs CLI/dev tooling)
- **Lightning Web Components** (`ownersPortalHome`, `ownerAssistant`) — author + deploy only.
- **256 fields at once** — possible but absurd by hand; bulk tooling is the real answer.
- Everything else above is 100% clickable in Setup.
