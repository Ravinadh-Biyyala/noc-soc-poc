# Auto-Dashboard Pipeline — How It Works (End-to-End)

A field guide to the autonomous, multi-agent BI pipeline in
[`app/agents/auto_pipeline/`](.). It explains the user-facing trigger, the
orchestration graph, every sub-agent (its exact input, the prompt it is given,
the tools it can call, what it does, and what it returns), the visuals catalog,
dashboard assembly, and finally a fully worked example using **Project 8 —
"Hilton Project"** with that project's real data.

---

## 1. What it is, in one paragraph

The user clicks **"Auto-generate dashboard"** on a project. One HTTP call
(`POST /api/projects/{id}/dashboards/auto-generate`) kicks off a LangGraph
`StateGraph` that chains seven roles end-to-end with **no human approval gate**:
Profiler → Cleaning → Merging → (5 Analysis lenses in parallel) → Visualization
→ Assemble. Each role is itself a small **ReAct agent** (LLM ↔ tool loop) that
talks to the project's Postgres schemas through a tight set of SQL-guarded
tools, and hands back a **structured result** by calling a `submit_*` tool
exactly once. The orchestrator streams progress to the browser over
Server-Sent Events (SSE) and finishes by writing a real dashboard (charts + KPI
cards) and a Markdown narrative report into the database.

```
        POST .../dashboards/auto-generate            (user click)
                     │  SSE stream
                     ▼
START ─▶ profiler ─▶ cleaning ─▶ merging ─┬─▶ analysis_descriptive ─┐
                                          ├─▶ analysis_diagnostic ──┤
                                          ├─▶ analysis_predictive ──┤
                                          ├─▶ analysis_prescriptive ┼─▶ visualization ─▶ assemble ─▶ END
                                          └─▶ analysis_comparative ─┘   (barrier)      (charts+report
                                            (fan-out, run concurrently)                 → dashboard row)
```

Defined in [`graph.py`](graph.py). The 5 lenses fan out from `merging` and fan
back into `visualization`; LangGraph treats the multiple incoming edges as a
**barrier**, so `visualization` fires only after all five lenses finish.

---

## 2. User interaction & the data contract

### 2.1 Entry point — [`routes/auto_dashboard.py`](../../routes/auto_dashboard.py)

```
POST /api/projects/{project_id}/dashboards/auto-generate
```

1. `parse_id` + `load_project_or_404` validate the project exists.
2. `list_raw_tables(project_id)` is checked — **if the project has no raw
   tables, it returns HTTP 400** ("No raw data to analyse…"). This is the only
   hard precondition.
3. Otherwise it returns a `StreamingResponse` of `text/event-stream`; each event
   is `data: {json}\n\n`.

When `AGENTS_SERVICE_URL` is set, the Express server proxies the entire
`dashboards` route group to this Python service unchanged.

### 2.2 The SSE event protocol — [`service.py`](service.py)

`stream_auto_dashboard(project_id, project_name, project_description)` drives the
graph with `stream_mode="updates"` and translates each node's state-delta into
one of these events:

| `type`      | When                               | Key fields |
|-------------|------------------------------------|------------|
| `plan`      | first, before any work             | `phases[]` (6 entries), `lenses[]` (the 5 lens names) |
| `phase`     | profiler/cleaning/merging/viz done | `name`, `status:"done"`, `detail`, plus `tables` / `strategy` / `charts` |
| `finding`   | each analysis lens completes       | `lens`, `summary` |
| `warning`   | a non-fatal error during assemble  | `message` |
| `error`     | fatal failure or no dashboard      | `message` |
| `done`      | success (terminal)                 | `dashboardId`, `report` (Markdown), `charts` (count) |

The frontend renders the `plan` as a checklist and ticks each phase as `phase` /
`finding` events arrive, then navigates to `dashboardId` on `done`.

### 2.3 What the orchestrator passes in

The graph's **initial state** is only three fields ([`service.py`](service.py)):

```python
{ "project_id": 8, "project_name": "Hilton Project",
  "project_description": "Hilton owners, suppliers, brokers analysis." }
```

Everything else (`profile`, `cleaned`, `merge`, `findings`, `charts`, `report`,
`dashboard_id`) is produced by the nodes as the run proceeds. A fresh
`thread_id` (`auto-pipeline:{id}:{uuid}`) is minted per run, with
`recursion_limit: 80`.

---

## 3. Shared state & the graph — [`state.py`](state.py), [`graph.py`](graph.py)

`AutoPipelineState` is a `TypedDict` (channels):

| Channel | Written by | Reducer | Meaning |
|---|---|---|---|
| `project_id`, `project_name`, `project_description` | init | — | inputs |
| `profile` | profiler | replace | raw schema map + narrative |
| `cleaned` | cleaning | replace | `{summary, tables[], warehouseTables[]}` |
| `merge` | merging | replace | `{strategy, flatTable?, analysisTargets[], links[], summary}` |
| `findings` | 5 lenses | **`merge_dict`** | `lens -> finding` (concurrent writers) |
| `charts` | visualization | replace | list of chart specs |
| `report` | assemble | replace | Markdown narrative |
| `dashboard_id` | assemble | replace | created dashboard PK |
| `errors` | any | **`operator.add`** | accumulated non-fatal errors |

`findings` and `errors` need reducers because the 5 lens nodes run in the **same
super-step** and would otherwise clobber each other's writes. `merge_dict` does
a shallow dict-merge; `operator.add` concatenates the error lists.

`ANALYSIS_LENSES = ["descriptive", "diagnostic", "predictive", "prescriptive",
"comparative"]`.

---

## 4. The sub-agent machinery (shared by every role)

Every role below is built on the same three pieces. Understand these once and
each agent becomes "just a prompt + a tool list".

### 4.1 The ReAct loop — [`shared/react.py`](../shared/react.py)

`build_agent_graph(tools, checkpointer, max_tokens, name)` compiles a 2-node
LangGraph over `MessagesState`:

- **`agent`** node — the chat model (`make_chat_model`, OpenAI `gpt-4.1-mini`)
  **bound to the role's tools**. It either answers or emits tool calls.
- **`tools`** node — a prebuilt `ToolNode` that executes the requested tools.
- Looped via `tools_condition`: `agent → tools → agent → …` until the model
  stops calling tools. `recursion_limit = max_iterations * 2 + 1`.

`run_agent(...)` seeds the conversation with `[SystemMessage(system_prompt),
HumanMessage(user_message)]`, invokes the graph, and returns a summary dict:
`{finalText, iterations, toolCallCount, toolCallsByName}`.

### 4.2 The `submit_*` capture pattern — [`_run.py`](_run.py)

Agents don't "return" structured data through their text — they **call a tool**.
`make_submit_tool(name, description, model, holder)` builds a `StructuredTool`
whose **args schema is a Pydantic model**. When the agent calls it, the args are
validated into that model and written into a closure dict `holder`. The caller
(the node function) reads `holder` after the run. This guarantees a typed,
schema-validated payload regardless of how chatty the model was.

`run_subagent(...)` ([`_run.py`](_run.py)) is the thin wrapper each node uses:
build graph → new thread → `run_agent` → on exception, return a safe stub so the
pipeline never crashes mid-phase.

### 4.3 The SQL-guarded tools — [`auto_tools.py`](auto_tools.py)

All database access goes through factory-built `StructuredTool`s. Two schemas
exist per project: `proj_{id}_raw` (read-only landing zone) and
`proj_{id}_warehouse` (curated output). Every SQL string is passed through:

- `assert_select_only(sql)` — rejects anything that isn't a single read-only
  `SELECT` / `WITH … SELECT`.
- `assert_schema_scope(sql, [allowed schemas])` — rejects references outside the
  project's own raw/warehouse schemas.
- A `SET statement_timeout = 8000` guard and a **200-row cap** on results.

| Tool (factory) | Args | What it does |
|---|---|---|
| `list_raw_tables` (`make_list_raw_tool`) | none | Raw tables with columns, types, row counts. |
| `list_warehouse_tables` (`make_list_warehouse_tool`) | none | Warehouse tables/views with columns. |
| `profile_table` (`make_profile_tool`) | `table` | Row count + per-column null/distinct/min/max (caps 20 cols, 8s timeout). |
| `run_sql` (`make_read_sql_tool`) | `sql` | SELECT against **raw + warehouse** (cleaning uses this). |
| `run_sql` (`make_warehouse_query_tool`) | `sql` | SELECT against **warehouse only** (merging/analysis/viz). |
| `materialize_table` (`make_materialize_tool`) | `target_table, select_sql, kind` | DROP-then-CREATE `warehouse.auto_<name>` from a validated SELECT. Name is sanitised and force-prefixed `auto_`. |
| `get_visuals_catalog` (`make_catalog_tool`) | `query?` | Look up supported chart types from the visuals catalog. |
| `save_relationships` (inline in merging) | `links[]` | Persist join edges to `project_relationship_links` (replaces prior). |
| `submit_*` (one per role) | role-specific | Hand back the structured result; called once. |

The agent **never writes raw `CREATE`** — only `materialize_table` does, and only
for `auto_`-prefixed relations.

---

## 5. The agents, one by one

For each: **exact input → prompt given → tools → what it performs → output**.

---

### 5.1 Data Profiler — [`profiler.py`](profiler.py)  ·  agent name `auto-profiler`

**Exact input.** `project_id`, `project_name`, `project_description`. Before the
LLM runs, `raw_tables_with_columns(project_id)` is fetched **deterministically**
and seeded into the prompt — so the phase is robust even if the model under-uses
its tools.

**Prompt (templated by `_build_prompt`).** Roughly:

```
You are the Data Profiler in an autonomous BI pipeline.
PROJECT: "<name>".
GOAL: <description>

RAW TABLES (read-only landing zone):
- "<table>" (~<rows> rows): <col type, col type, … up to 24 cols>
  …

YOUR JOB:
1. Call profile_table on the 2-4 most important tables to inspect nulls, distinct counts and ranges.
2. Identify each table's likely role (fact vs dimension) and its candidate key/join columns.
3. Call submit_profile ONCE with a concise summary and one entry per table. Then stop.
Be fast and decisive — this is the first of several phases.
```

User message: `"Profile the raw data now, then call submit_profile."`
`max_iterations=8`.

**Tools:** `list_raw_tables`, `profile_table` (raw layer), `submit_profile`.

**What it performs.** Inspects the 2–4 most important raw tables (null counts,
distinct counts, numeric min/max), infers each table's role and candidate
join/key columns.

**Output** (`ProfileResult` → `state["profile"]`):

```python
{ "summary": str,                       # 2-3 sentence overview
  "tables": [ { "table": str, "role": str,
                "keyColumns": [str], "note": str } ],
  "rawTables": [...] }                   # appended deterministically (full schema)
```

**Fallback.** If the agent never calls `submit_profile`, a deterministic
`summary` + one bare entry per raw table is synthesised so downstream phases
always have the schema map.

---

### 5.2 Data Cleaning — [`cleaning.py`](cleaning.py)  ·  agent name `auto-cleaning`

**Exact input.** `project_id` + `state["profile"]` (which carries `rawTables`
and the profiler `summary`).

**Prompt (`_build_prompt`).** Includes the raw + warehouse schema names, every
raw table's columns, and the profiler summary, then:

```
You are the Data Cleaning agent in an autonomous BI pipeline. Reason in multiple hops.
RAW schema: "proj_<id>_raw"   WAREHOUSE schema (your output): "proj_<id>_warehouse"

RAW TABLES:
- "<table>": <cols…>

PROFILER SUMMARY: <…>

YOUR JOB — for EACH meaningful raw table:
1. Optionally run_sql to inspect distinct values / suspect rows.
2. Call materialize_table(target_table, select_sql) where select_sql is a SELECT reading from "proj_<id>_raw".
   In the SELECT: cast numeric/date columns to proper types, TRIM/standardise text, coalesce or filter
   nulls in key columns, and drop obvious outliers (e.g. negative amounts, impossible dates).
   Name targets like 'auto_clean_<table>'. The tool DROP-then-CREATEs the warehouse table for you.
3. After all tables are cleaned, call submit_cleaning ONCE with one entry per table. Then stop.
Keep SELECTs fully-qualified and SELECT-only. Do NOT write CREATE yourself — materialize_table does that.
```

User message: `"Clean every meaningful raw table, then call submit_cleaning."`
`max_iterations=14, max_tokens=4096`.

**Tools:** `run_sql` (raw+warehouse), `profile_table`, `materialize_table`,
`submit_cleaning`.

**What it performs.** For each meaningful raw table, writes a SELECT that casts
types, trims/standardises text, handles nulls, and drops outliers, then
materialises it as `proj_<id>_warehouse.auto_clean_<table>`.

**Output** (`CleaningResult` → `state["cleaned"]`):

```python
{ "summary": str,
  "tables": [ { "source": str, "target": "auto_clean_…", "note": str } ],
  "warehouseTables": [ "auto_…" ] }     # actual auto_* tables now in the warehouse
```

**Fallback (`_fallback_passthrough`).** If the agent produced **no** `auto_*`
tables, every raw table is copied verbatim into `auto_clean_<table>` so later
phases have data (noted as "passthrough copy"). If even that yields nothing, an
error is pushed to `errors`.

---

### 5.3 Data Merging — [`merging.py`](merging.py)  ·  agent name `auto-merging`

**Exact input.** `project_id` + `state["cleaned"]` (its `warehouseTables`).

**Prompt (`_build_prompt`).** Lists the cleaned warehouse tables, then:

```
You are the Data Merging agent in an autonomous BI pipeline. Reason in multiple hops.

CLEANED WAREHOUSE TABLES available to merge:
- <table> …

YOUR JOB:
1. Call list_warehouse_tables to see exact columns of each cleaned table.
2. Match candidate join columns across tables by name + type. Use run_sql with COUNT(*) and
   COUNT(DISTINCT key) to probe cardinality (is the key unique on one side?).
3. DECIDE:
   - If there is ONE table only -> strategy='single' (no merge).
   - If joins are 1:1 or 1:N and would NOT explode rows -> build ONE denormalised flat table via
     materialize_table(target_table='auto_flat_main', select_sql=<a SELECT with the JOINs>). strategy='flat'.
   - If any join is N:N or would fan out rows badly -> DO NOT flatten. Call save_relationships with the
     join edges instead. strategy='metadata'.
4. Call submit_merge ONCE with your decision. Then stop.
SELECTs must be fully-qualified and SELECT-only; materialize_table writes the CREATE for you.
```

User message: `"Find join keys, decide flat-vs-metadata, act, then call
submit_merge."` `max_iterations=14, max_tokens=4096`.

**Tools:** `list_warehouse_tables`, `run_sql` (warehouse), `materialize_table`,
`save_relationships`, `submit_merge`.

**What it performs.** Probes cardinality across cleaned tables and chooses one
of three strategies:
- **`single`** — only one table, nothing to merge.
- **`flat`** — safe 1:1 / 1:N joins → builds one denormalised `auto_flat_main`.
- **`metadata`** — N:N / fan-out risk → saves join edges to
  `project_relationship_links` instead, and analysis joins on the fly.

**Output** (`MergeResult` + resolution logic → `state["merge"]`):

```python
{ "strategy": "flat" | "metadata" | "single",
  "flatTable": "auto_flat_main" | None,
  "summary": str,
  "analysisTargets": [ "auto_…" ],   # which warehouse tables the lenses read
  "links": [ {fromTable, fromColumn, toTable, toColumn, cardinality, rationale} ] }
```

`analysisTargets` is computed deterministically after the run: the flat table if
one exists, otherwise the `auto_*` cleaned tables. So analysis always has a
target list even if the LLM was vague.

---

### 5.4 Analysis — 5 lenses in parallel — [`analysis.py`](analysis.py)

One `run_analysis_lens(state, lens)` body, instantiated five times
(`auto-analysis-descriptive`, `-diagnostic`, `-predictive`, `-prescriptive`,
`-comparative`). They run **concurrently** in one super-step and each writes
`{"findings": {lens: …}}`, merged via the `merge_dict` reducer.

**Exact input.** `project_id`, `project_name`, `project_description`, and from
`state["merge"]`: `analysisTargets` and `links`. The warehouse schema (columns)
is fetched live; `_schema_context` builds the table list + known join paths.

**Prompt (`_build_prompt`).** Per-lens:

```
You are the <Lens> Analysis agent in an autonomous BI pipeline. Reason in multiple hops.
PROJECT: "<name>".
GOAL: <description>

WAREHOUSE TABLES you may query:
- "<table>": <cols…>
KNOWN JOIN PATHS (join on the fly):
- a.x = b.y (N:1) …

FOCUS: <lens-specific guidance — see below>

YOUR JOB:
1. Run AT MOST 4 run_sql queries (SELECT-only, warehouse schema, <=200 rows) to gather evidence.
   Prefer a few well-chosen aggregate queries over many small ones.
2. Reason over the results.
3. Then you MUST call submit_finding ONCE with a summary, number-backed key findings, any
   recommendations, and the headline metrics worth charting. Do not exceed 4 queries before submitting.
```

User message: `"Perform the <lens> analysis now (max 4 queries), then call
submit_finding."` `max_iterations=14, max_tokens=4096`.

**The five `LENS_GUIDANCE` focuses:**

| Lens | Focus (what it's told to find) |
|---|---|
| **descriptive** | *What happened.* Totals, averages, counts, min/max, distribution across main categoricals. Headline numbers and biggest segments. |
| **diagnostic** | *Why it happened.* Drivers, correlations, anomalies; compare segments vs overall average, rank contributors, flag outliers (window fns / GROUP BY). |
| **predictive** | *What's likely next.* Period-over-period growth / moving trends in SQL, reason (no ML) about near-term direction and rising segments. |
| **prescriptive** | *What to do.* Concrete business actions tied to a queried number — where to focus, what to fix, which segments to grow/de-risk. |
| **comparative** | *How groups/periods differ.* Side-by-side: segment vs segment, period vs prior, top vs bottom; quantify the gaps. |

**Tools:** `run_sql` (warehouse only) + `submit_finding`. *Analysis cannot
write tables* — it is strictly read-only.

**What it performs.** ≤4 aggregate SQL queries against the warehouse, then LLM
reasoning over the rows. "Predictive" / "prescriptive" are LLM reasoning over
SQL aggregates and window functions — **no ML model is trained**.

**Output** (`FindingResult` → `state["findings"][lens]`):

```python
{ "summary": str,                                  # 2-4 sentence narrative
  "keyFindings": [str],                            # 3-6 number-backed bullets
  "recommendations": [str],                        # mainly for prescriptive
  "metrics": [ { "label": str, "value": "1,234" } ],# headline metrics to chart
  "lens": "<lens>" }
```

**Fallback.** If a lens didn't submit, a stub with the agent's final text and
empty lists is stored so the report/visualization still see the key.

---

### 5.5 Data Visualization — [`visualization.py`](visualization.py)  ·  `auto-visualization`

**Exact input.** `project_id`, the warehouse schema (columns) limited to
`analysisTargets`, and **all five lenses' findings** (digested into the prompt).

**Prompt (`_build_prompt`).** Schema context + a digest of every lens's summary
and top key-findings + the **catalog digest** (one line per supported chart with
when-to-use and data-needed), then:

```
You are the Data Visualization agent in an autonomous BI pipeline.
PROJECT: "<name>".

WAREHOUSE TABLES you may query: …
ANALYSIS FINDINGS to visualise: [descriptive] … • … / [diagnostic] … / …
SUPPORTED CHART TYPES (pick chartType from the FIRST token of each line): <catalog digest>

YOUR JOB:
1. For each important finding, pick the BEST chart type for its data shape (use get_visuals_catalog if unsure).
2. Write the SELECT that produces that chart's data and run it with run_sql to get the rows.
3. Build 5-8 charts total. Each chart config MUST include: sql (the exact SELECT), data (the returned rows),
   xKey (categorical column) and yKey (numeric column, or list for multi-series).
4. Do NOT emit 'kpi' cards — those are generated automatically.
5. Call submit_charts ONCE with all charts. Then stop.
```

User message: `"Design 5-6 charts, fetch each chart's data with one run_sql
call, then call submit_charts."` `max_iterations=20, max_tokens=6000`.

**Tools:** `run_sql` (warehouse), `get_visuals_catalog`, `submit_charts`.

**What it performs.** Chooses chart types matched to each finding's data shape,
runs the SELECT that produces each chart's rows, and packages each as a spec
carrying its SQL, the queried rows, and `xKey`/`yKey`.

**Output** (`VisualizationResult` → `state["charts"]`). Each `ChartSpec`:

```python
{ "title": str,
  "chartType": "<one of the supported dashboardChartType values>",
  "config": { "sql": "<SELECT>", "data": [rows],
              "xKey": "<categorical>", "yKey": "<numeric or [numeric,…]>" } }
```

**Post-processing.** Charts whose `chartType` isn't in the supported set, or
whose `config` is malformed, are dropped. If **nothing survives**,
`_fallback_chart` runs a `SELECT * … LIMIT 50` on the first target and emits a
single `table` chart so a dashboard can still be built.

**The visuals catalog** ([`visuals_catalog.json`](visuals_catalog.json), loaded
by [`catalog.py`](catalog.py)) is the agent's knowledge source — extracted from
the frontend's `VisualsCatalog` page. Each entry has `dashboardChartType`,
`whenToUse`, `dataNeeded`, and a `supported` flag. **Only `supported: true`
types are offered** (e.g. choropleth maps are unsupported and map to a
`horizontal-bar` fallback). The prompt gets a compact digest; the agent fetches
full detail on demand via `get_visuals_catalog`.

---

### 5.6 Assemble — [`graph.py`](graph.py) `_assemble_node` + [`report.py`](report.py) + [`../data_modeler/dashboards.py`](../data_modeler/dashboards.py)

This is **deterministic code, not an LLM agent**.

**Exact input.** The whole accumulated state (`profile`, `cleaned`, `merge`,
`findings`, `charts`).

**What it performs.**
1. `assemble_report(state)` stitches a Markdown report:
   `# <name> — Automated Insight Report` → **Executive Summary** (first key
   finding from each lens, ≤6) → **How This Was Built** (profiler / cleaning /
   merging summaries) → one section per lens (`## <Lens Title>` + summary +
   key-findings) → **Recommended Actions** (deduped recommendations) → **Notes**
   (any accumulated errors).
2. `create_project_dashboard(project_id, title, charts, report_md)`:
   - `normalize_agent_charts` repairs/validates each chart — drops KPI charts
     (regenerated separately), drops charts with no data, infers missing
     `xKey`/`yKey`, downgrades bad scatter/bubble to bar.
   - Inserts a `user_dashboards` row (the Markdown report rides in `agent_log`)
     and the chart rows.
   - `ensure_project_kpis` auto-generates up to **4 KPI stat cards** by querying
     the warehouse directly (Total Records, Total/Avg of the best numeric
     column, Distinct of the best categorical) — chosen via keyword heuristics
     (`revenue|amount|premium|commission…` for numeric, `region|broker|
     segment…` for categorical).

**Output** (`state` deltas): `{report: <markdown>, dashboard_id: <id>}` — or, on
failure, `{report, errors:[…]}` (which the SSE layer turns into `warning`/`error`).

---

## 6. Worked example — Project 8, "Hilton Project"

> **Project 8** in this database — `workspaces.id = 8`, name **"Hilton
> Project"**, description *"Hilton owners, suppliers, brokers analysis."* All
> numbers below are **the actual data** in `proj_8_raw.*` at the time of writing
> (218 brokers, 224 owners, 213 suppliers).

### 6.0 The raw data (what the user uploaded)

`proj_8_raw` holds three CSV-derived tables:

| Table | Rows | Notable columns |
|---|---|---|
| `hilton_brokers_brokers` | 218 | `broker_id, region, brand, deal_type, deal_value_usd, commission_pct, commission_usd, deal_date, status, …` |
| `hilton_owners_owners` | 224 | `owner_id, owner_type, country, number_of_rooms, annual_revenue_usd, occupancy_rate_pct, adr_usd, revpar_usd, …` |
| `hilton_suppliers_suppliers` | 213 | `supplier_id, category, annual_spend_usd, performance_rating, contract_start/end_date, status, …` |

These tables share `property_name`, `brand`, `city`, `country` columns but have
**no clean shared primary key** — brokers/owners/suppliers are three different
entities about the same hotel universe.

### 6.1 Profiler — what it would produce

Calling `profile_table` on the three tables surfaces the real shape and several
**data-quality problems** (which matter for the next phase):

- `hilton_owners_owners.occupancy_rate_pct` ranges **−5 to 120** — both ends are
  impossible (an occupancy rate must be 0–100): outliers to filter.
- `region` (brokers) has **inconsistent labels**: `North America` (36) **and**
  `N. America` (1), plus 3 **blank** rows.
- `status` columns are case-inconsistent everywhere: brokers `Closed` (94) vs
  `CLOSED` (4), `Cancelled` (34) vs `CANCELLED` (2); suppliers `Active` (106) vs
  `active` (3), `Suspended` (27) vs `suspended` (2), `Pending Review` vs
  `pending review`.
- `owner_type` has the same casing drift: `Family Office` (33) vs `FAMILY
  OFFICE` (2), `Individual` (39) vs `INDIVIDUAL` (1), etc., plus blanks.

**`submit_profile` payload (illustrative):**

```json
{ "summary": "Three independent entity tables describe the Hilton hotel universe: 218 broker deals, 224 owned properties, and 213 suppliers. They share property/brand/city/country text columns but no shared surrogate key; brokers and owners are the fact-like tables, suppliers is a reference/cost table.",
  "tables": [
    {"table": "hilton_brokers_brokers", "role": "fact/transactional",
     "keyColumns": ["broker_id", "property_name", "brand"],
     "note": "~218 deals; deal_value_usd & commission_usd numeric; region/status need standardising"},
    {"table": "hilton_owners_owners", "role": "fact/dimension",
     "keyColumns": ["owner_id", "property_name", "brand"],
     "note": "~224 properties; occupancy_rate_pct has impossible values (-5..120)"},
    {"table": "hilton_suppliers_suppliers", "role": "dimension/cost",
     "keyColumns": ["supplier_id", "category"],
     "note": "~213 suppliers; status & category casing inconsistent"}
  ] }
```

### 6.2 Cleaning — what it would produce

For each table it issues a `materialize_table('auto_clean_<t>', <SELECT>)`. The
SELECTs do roughly:

```sql
-- auto_clean_hilton_owners_owners
SELECT owner_id, INITCAP(TRIM(owner_type)) AS owner_type, TRIM(country) AS country,
       number_of_rooms::numeric, annual_revenue_usd::numeric,
       occupancy_rate_pct::numeric, adr_usd::numeric, revpar_usd::numeric, …
FROM proj_8_raw.hilton_owners_owners
WHERE occupancy_rate_pct BETWEEN 0 AND 100;          -- drop the -5 / 120 outliers

-- auto_clean_hilton_brokers_brokers
SELECT broker_id,
       CASE WHEN region ILIKE 'n. america' THEN 'North America' ELSE INITCAP(TRIM(region)) END AS region,
       brand, deal_type, INITCAP(TRIM(status)) AS status,            -- CLOSED/closed -> Closed
       deal_value_usd::numeric, commission_pct::numeric, commission_usd::numeric, deal_date::timestamptz
FROM proj_8_raw.hilton_brokers_brokers
WHERE region <> '' AND deal_value_usd >= 0;

-- auto_clean_hilton_suppliers_suppliers
SELECT supplier_id, INITCAP(TRIM(category)) AS category, INITCAP(TRIM(status)) AS status,
       annual_spend_usd::numeric, performance_rating::numeric, contract_start_date, contract_end_date
FROM proj_8_raw.hilton_suppliers_suppliers;
```

**`submit_cleaning` payload (illustrative):**

```json
{ "summary": "Standardised text casing on status/region/owner_type/category, cast numerics and dates to proper types, and dropped impossible occupancy rates (<0 or >100) and blank-region broker rows.",
  "tables": [
    {"source": "hilton_owners_owners", "target": "auto_clean_hilton_owners_owners",
     "note": "cast numerics; filtered occupancy_rate_pct to 0-100"},
    {"source": "hilton_brokers_brokers", "target": "auto_clean_hilton_brokers_brokers",
     "note": "merged 'N. America'->'North America'; INITCAP status; dropped blank-region rows"},
    {"source": "hilton_suppliers_suppliers", "target": "auto_clean_hilton_suppliers_suppliers",
     "note": "INITCAP status & category; cast spend/rating"}
  ] }
```

`state["cleaned"].warehouseTables = ["auto_clean_hilton_brokers_brokers",
"auto_clean_hilton_owners_owners", "auto_clean_hilton_suppliers_suppliers"]`.

### 6.3 Merging — what it would produce

The agent probes join keys with `COUNT(*)` / `COUNT(DISTINCT …)`. The three
tables share only `property_name` / `brand` / `city` / `country`, and those keys
are **not unique on any side** (many brokers ↔ many owners ↔ many suppliers per
brand/city) → a join would **fan out rows badly**. So it picks **`metadata`**,
not `flat`:

**`save_relationships` then `submit_merge`:**

```json
{ "strategy": "metadata",
  "flatTable": null,
  "summary": "No safe 1:1/1:N key across brokers, owners and suppliers — they share only brand/city/country (N:N). Flattening would explode rows, so join edges were saved as metadata and each table is analysed directly.",
  "links": [
    {"fromTable":"auto_clean_hilton_brokers_brokers","fromColumn":"brand","toTable":"auto_clean_hilton_owners_owners","toColumn":"brand","cardinality":"N:N","rationale":"shared Hilton brand"},
    {"fromTable":"auto_clean_hilton_owners_owners","fromColumn":"city","toTable":"auto_clean_hilton_suppliers_suppliers","toColumn":"city","cardinality":"N:N","rationale":"suppliers serve hotels in a city"}
  ] }
```

`analysisTargets = ["auto_clean_hilton_brokers_brokers",
"auto_clean_hilton_owners_owners", "auto_clean_hilton_suppliers_suppliers"]`.

### 6.4 Analysis — the 5 lenses (grounded in real numbers)

Each lens runs ≤4 queries against the cleaned warehouse tables. Real results:

**Descriptive — what happened.**
- Total brokered deal value ≈ **$49.7 B** across 218 deals; **Caribbean** is the
  largest region (54 deals, **$13.7 B**), then APAC ($9.7 B) and EMEA ($9.7 B).
- Owners: total annual revenue ≈ **$7.78 B** across ~221 properties (post-clean);
  **USA dominates** (121 properties, **$4.29 B**). Portfolio avg occupancy
  **66.8%**, avg ADR **$230**, avg RevPAR **$210**, ~99.8 K rooms.
- Suppliers: total annual spend ≈ **$256 M**; **Maintenance & Repair** is the
  single biggest category (**$106.5 M**, ~42% of all spend).

**Diagnostic — why.**
- Supplier spend is extremely concentrated: Maintenance & Repair alone is ~42%
  of spend on just 12 suppliers — a cost-driver and a vendor-concentration risk.
- Commission rate varies by region: North America & APAC ≈ **2.2%** vs EMEA &
  Latin America ≈ **1.9%** — a ~30 bps spread on multi-billion-dollar volume.
- Occupancy varies by owner type: **Private Equity (70.4%)** and **REIT
  (70.3%)** outperform **Individual (61.7%)** owners by ~8–9 points.

**Predictive — what's likely next.**
- Deal dates span **Jan 2019 → Dec 2025**. Year-over-year deal value trends
  upward into 2024–25; Caribbean and APAC are the rising regions and likely to
  keep leading near-term pipeline.
- High occupancy + ADR among REIT/PE owners suggests their RevPAR keeps
  outpacing individual owners absent intervention.

**Prescriptive — what to do.**
- *De-risk Maintenance & Repair spend* — dual-source or renegotiate the 12
  vendors carrying $106 M to cut concentration risk.
- *Lift commission discipline in EMEA / Latin America* toward the ~2.2% NA/APAC
  benchmark, or justify the discount.
- *Coach Individual owners* on the operating playbook that gives REIT/PE owners
  their ~9-point occupancy edge.
- *Double down on Caribbean & APAC* origination where deal value concentrates.

**Comparative — how groups differ.**
- Region vs region: Caribbean **$13.7 B** vs Latin America **$7.7 B** — a ~1.8×
  gap in brokered value.
- Owner type vs owner type: PE/REIT ~70% occupancy vs Individual ~62%.
- Supplier category: Maintenance & Repair ($106 M) dwarfs every other category
  (next is Kitchen Equipment at ~$13.6 M).

Each lens returns `summary`, 3–6 `keyFindings`, `recommendations`
(prescriptive-heavy), and `metrics` (e.g. `{"label":"Total Brokered Value",
"value":"$49.7B"}`).

### 6.5 Visualization — the charts it would build

Picking chart types from the catalog to match each finding's shape (5–8 charts):

| Title | chartType | xKey → yKey | SQL gist |
|---|---|---|---|
| Brokered Deal Value by Region | `bar` | `region` → `total_deal_value` | `GROUP BY region` |
| Annual Revenue by Country (Top 10) | `horizontal-bar` | `country` → `revenue` | owners `GROUP BY country ORDER BY revenue DESC LIMIT 10` |
| Supplier Spend by Category | `treemap` / `bar` | `category` → `annual_spend` | suppliers `GROUP BY category` |
| Occupancy Rate by Owner Type | `bar` | `owner_type` → `avg_occupancy` | owners `GROUP BY owner_type` |
| Deal Value Trend by Year | `line` | `deal_year` → `total_deal_value` | brokers `GROUP BY date_trunc('year', deal_date)` |
| Deal Type Mix | `pie` | `deal_type` → `total` | brokers `GROUP BY deal_type` |

Each `config` carries the exact `sql` + returned `data` rows. KPI cards are **not**
emitted here.

### 6.6 Assemble — the final artifacts

- **KPI cards** auto-generated by `ensure_project_kpis` (heuristics pick a
  revenue/value numeric column): e.g. *Total Records*, *Total Annual Revenue*,
  *Avg Occupancy Rate*, *Distinct Country*.
- **Dashboard** row written to `user_dashboards` (title *"Hilton Project — Auto
  Dashboard"*), with the 6 charts + up to 4 KPI cards inserted.
- **Markdown report** stored in `agent_log` and returned to the browser:

```markdown
# Hilton Project — Automated Insight Report

## Executive Summary
- Total brokered deal value ≈ $49.7B across 218 deals; Caribbean leads at $13.7B.
- Supplier spend is concentrated: Maintenance & Repair is ~42% of $256M total.
- Commission rates run ~30 bps higher in NA/APAC (2.2%) than EMEA/LatAm (1.9%).
- PE/REIT owners run ~70% occupancy vs ~62% for Individual owners.
- USA owns 121 of ~221 properties and $4.29B of $7.78B annual revenue.

## How This Was Built
**Data profiled:** Three independent entity tables (brokers, owners, suppliers)…
**Cleaning:** Standardised casing, cast numerics/dates, dropped impossible occupancy values…
**Merging (metadata):** No safe single key across the three entities; join edges saved as metadata…

## Descriptive Analysis — What Happened
…
## Diagnostic Analysis — Why It Happened
…
## Predictive Analysis — What's Likely Next
…
## Prescriptive Analysis — Recommended Actions
…
## Comparative Analysis — How Groups Differ
…

## Recommended Actions
- De-risk Maintenance & Repair spend across 12 vendors carrying $106M…
- Lift EMEA / Latin America commission discipline toward the 2.2% benchmark…
- Coach Individual owners on the REIT/PE operating playbook…
```

The SSE stream ends with:

```json
{"type":"done","dashboardId":<id>,"report":"# Hilton Project — Automated Insight Report…","charts":6}
```

---

## 7. Reliability properties (why it rarely hard-fails)

- **Deterministic seeding** — the profiler pre-fetches the raw schema; merging
  and analysis compute `analysisTargets` after the LLM, so a vague model still
  yields usable downstream input.
- **Fallbacks at every risky phase** — cleaning passthrough-copies if no tables
  were made; visualization emits a sample `table` chart if nothing valid; each
  lens stores a stub if it didn't submit.
- **Hard SQL guardrails** — select-only + schema-scope validation, 8s statement
  timeout, 200-row cap, writes restricted to `auto_`-prefixed warehouse
  relations via DROP-then-CREATE.
- **The only fatal outcomes** — no raw tables at start (HTTP 400), or no
  dashboard could be created (`error` event).

---

## 8. File map

| File | Role |
|---|---|
| [`graph.py`](graph.py) | Orchestrator `StateGraph` (topology, fan-out/barrier). |
| [`state.py`](state.py) | `AutoPipelineState` channels + reducers + lens list. |
| [`service.py`](service.py) | SSE runner: graph deltas → frontend events. |
| [`profiler.py`](profiler.py) | Data Profiler sub-agent. |
| [`cleaning.py`](cleaning.py) | Data Cleaning sub-agent (+ passthrough fallback). |
| [`merging.py`](merging.py) | Data Merging sub-agent (flat / metadata / single). |
| [`analysis.py`](analysis.py) | 5 analysis-lens sub-agents (parallel). |
| [`visualization.py`](visualization.py) | Chart-design sub-agent (+ fallback chart). |
| [`report.py`](report.py) | Deterministic Markdown report assembler. |
| [`catalog.py`](catalog.py) · [`visuals_catalog.json`](visuals_catalog.json) | Visuals knowledge source for the viz agent. |
| [`auto_tools.py`](auto_tools.py) | SQL-guarded tool factories. |
| [`_run.py`](_run.py) | `run_subagent` + `submit_*` capture helpers. |
| [`../shared/react.py`](../shared/react.py) | The shared ReAct loop builder. |
| [`../data_modeler/dashboards.py`](../data_modeler/dashboards.py) | Chart normalisation, KPI synthesis, dashboard insert. |
| [`../../routes/auto_dashboard.py`](../../routes/auto_dashboard.py) | HTTP entry point. |
