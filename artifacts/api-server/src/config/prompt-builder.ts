import { getTenantConfig, buildDataContext } from "./index.js";
import type { TenantConfig } from "./types.js";
import { db, datasets as datasetsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

function interpolateBranding(template: string, config: TenantConfig): string {
  return template
    .replace(/\{copilotName\}/g, config.branding.copilotName)
    .replace(/\{name\}/g, config.branding.name)
    .replace(/\{industry\}/g, config.branding.industry)
    .replace(/\{dateRange\}/g, config.branding.dateRange)
    .replace(/\{currencySymbol\}/g, config.branding.currencySymbol);
}

function buildDashboardList(config: TenantConfig): string {
  return config.sections.map(s => {
    const kpiNames = s.kpis.map(k => k.label).join(", ");
    const chartNames = s.charts.map(c => c.title).join(", ");
    const tableNames = s.tables.map(t => t.title).join(", ");
    const parts = [kpiNames, chartNames, tableNames].filter(Boolean).join(", ");
    return `- ${s.label} (${s.route}) — ${parts}`;
  }).join('\n');
}

function buildTerminologyBlock(config: TenantConfig): string {
  if (config.prompt.domainTerminology.length === 0) return "";
  return `Always use proper ${config.branding.industry} terminology: ${config.prompt.domainTerminology.join(", ")}.`;
}

function buildFewShotBlock(config: TenantConfig): string {
  if (config.prompt.fewShotExamples.length === 0) return "";
  return config.prompt.fewShotExamples.map(ex =>
    `User: "${ex.user}"\nResponse: ${ex.assistant}`
  ).join('\n\n');
}

const NAVIGATION_RULES = `PAGE NAVIGATION — navigate_to_page tool:
Use navigate_to_page ONLY when the user explicitly asks to go to a page, open a section, or switch views
("go to", "take me to", "open", "navigate to", "show me the X page").
NEVER navigate without being explicitly asked.

CORE APPLICATION PAGES:
- /               → Home — connect data sources, start new analysis
- /projects       → Projects — all data projects and their pipeline status
- /dashboards     → Dashboards — gallery of AI-generated and tenant dashboards
- /settings       → Settings — theme, AI model, file limits, domain packs
- /governance     → Governance — Enterprise permissions, lineage, audit (placeholder)
- /visuals-catalog → Visuals Catalog — all available chart types
- /postgres-browser → Postgres Browser — run SQL against connected databases
Dashboard sections are navigable via their routes listed in AVAILABLE DASHBOARDS above.

HINT NAVIGATION (passive suggestion — use [NAVIGATE:/route] in response text):
After answering a question, include [NAVIGATE:/route] to surface a "View Dashboard" button.
Do NOT combine navigate_to_page (autonomous) with [NAVIGATE:/route] for the same route in one response.`;

const CHART_RULES = `CRITICAL RULE — GENERATIVE BI VISUALS:
Every data question gets a visual. Choose the right format:

━━ CHART — trends, comparisons, distributions, compositions ━━
[CHART:{"type":"<type>","title":"Chart Title","xKey":"labelField","yKey":"valueField","data":[{"labelField":"Label1","valueField":123}]}]

Chart type guide — pick the best fit:
- "bar"           → vertical bars, entity vs entity (revenue by region, claims by type)
- "horizontal-bar"→ ranked list where labels are long (top 10 agents, products ranked by premium)
- "stacked-bar"   → part-to-whole split across categories; use yKey as array: ["series1","series2"]
- "line"          → trends over time (monthly premium, quarterly loss ratio); supports multi-series yKey array
- "area"          → filled trend, emphasises cumulative volume over time
- "pie"           → composition / mix, max 6 slices (portfolio mix, segment share)
- "donut"         → same as pie; preferred when highlighting a single center metric
- "scatter"       → correlation between two numeric fields (loss amount vs age, premium vs claim count)
- "bubble"        → scatter + size dimension; yKey array: ["yField","sizeField"]
- "combo"         → bar for volume + line for rate on dual axes; yKey array: ["barField","lineField"]
  Example: [CHART:{"type":"combo","xKey":"month","yKey":["revenue","growthRate"],"data":[...]}]
- "funnel"        → staged conversion / pipeline (claim stages, sales pipeline, policy renewal steps)
- "radar"         → multi-dimension profile (risk score across 5 categories, agent performance scorecard)
- "treemap"       → hierarchical size comparison (premium by product × region)
- "histogram"     → frequency distribution; xKey = bucket label (e.g. "0-10K"), yKey = count/frequency
- "bullet"        → actual vs target per category; yKey array: ["actualField","targetField"]
  Example: [CHART:{"type":"bullet","xKey":"agent","yKey":["actual","target"],"data":[{"agent":"Alice","actual":85000,"target":100000}]}]
- "waterfall"     → cumulative change breakdown (revenue bridge, cost decomposition)
- "heatmap"       → 2-D grid intensity; requires xKey (column dim), yKey (row dim), add "config":{"valueKey":"val"}
- "progress-bar"  → horizontal bars showing progress; add "config":{"maxKey":"targetField"} if targets differ per row
- "gauge"         → single dial (0–100 or 0–max); add "config":{"max":100,"label":"Loss Ratio"}

━━ TABLE — ranked lists, multi-column results, top-N details ━━
[TABLE:{"title":"Table Title","columns":["Col1","Col2","Col3"],"rows":[["A","B","C"],["D","E","F"]]}]
Use for: top customers, transaction lists, ranked breakdowns with multiple fields.
Keep to max 10 rows.

━━ METRIC — single KPI answer (count, total, average) ━━
[METRIC:{"title":"Metric Label","value":"$25,043","subtitle":"e.g. highest individual customer","trend":"up|down|neutral"}]
Use for: "how many", "what is the total", "what is the average" questions.

RULES (apply to all visual types):
1. ALWAYS emit at least one visual for any data question. NO EXCEPTIONS.
2. Use real query results when execute_dataset_query was called. Append "(Approximate)" to title only when using illustrative data.
3. Numbers in CHART data arrays must be raw numerics (no $ or commas). The frontend formats them.
4. xKey and yKey in CHART must exactly match keys in each data object.
5. Max 12 data points in charts, 10 rows in tables.
6. Write a 1–2 sentence insight BEFORE the visual.
7. You may combine visuals: e.g. a METRIC card + a CHART for context.
8. After visuals, add [NAVIGATE:/route] if a relevant dashboard exists.`;

const RESPONSE_RULES = `ADDITIONAL RESPONSE RULES:
1. Use **bold** for key entity names, metrics, and important numbers in bullet points and closing sentences.
2. CRITICAL FORMATTING — BULLET POINTS:
   Every bullet MUST be on its own line. Use this EXACT pattern:

**[Chart or Section Title]**

[1-2 sentence observation about the overall finding.]

- **[Entity A]** does X, meaning Y.
- **[Entity B]** does X, meaning Y.
- **[Entity C]** does X, meaning Y.

[Optional 1-sentence closing observation with **bold** key term.]

   FORBIDDEN — never write bullets inline like this:
   "Insights: - Entity A does X. - Entity B does Y." ← WRONG, never do this.
   Each "- " bullet MUST be preceded by a blank line or be at the start of a line. No exceptions.

3. Keep prose concise. Aim for 2–3 sentences max before bullets.
4. For navigation, include [NAVIGATE:/route] after the chart.
5. When the user asks to "Summarize" or "Analyze" a chart or metric, follow the template in rule 2 exactly: title → observation → bullets with **bold** entities → closing sentence.
6. When the user asks ANY data question — top N, rankings, breakdowns, trends, sums, counts — check the UPLOADED DATASETS list above. If datasets exist, call execute_dataset_query with the correct datasetId and a SELECT query. After getting results, emit the right visual: [TABLE:...] for ranked/multi-column lists, [METRIC:...] for single-value answers, [CHART:...] for trends/comparisons. NEVER say "the dashboard doesn't show this."
7. If asked about a specific time range, add a WHERE filter to the SQL and build the chart from those rows.
8. If execute_dataset_query returns an error, retry once with corrected SQL. Only fall back to approximate data if the dataset genuinely lacks the relevant columns.`;

// Interactive-actions rules for the CopilotKit right-rail. Unlike CHART_RULES /
// NAVIGATION_RULES (which drive the legacy token-based chat), this tells the
// agent it can DRIVE the app through real frontend actions exposed by the
// CopilotKit runtime as tools.
const ACTIONS_RULES = `INTERACTIVE ACTIONS — you can DRIVE the app, not just answer:
The runtime exposes frontend actions as tools. When the user asks you to go somewhere or do something, CALL the action — do not just describe what to click.
- navigateTo({ path }) — go to any app route (e.g. /projects, /dashboards, /settings).
- openDashboard({ projectId?, dashboardId?, index?, name? }) — open a specific dashboard. Use index for "open the 1st dashboard", name for "open the Executive Summary", or dashboardId when known. This action resolves the LIVE dashboard list itself, so ALWAYS call it to open a dashboard — never conclude "there are no dashboards" from the readable context without calling it first.
- switchProjectTab({ projectId?, tab }) — switch a project tab: connect | raw | dashboards | chat.
- createProjectDashboard({ projectId? }) — start AI dashboard generation for a project.
- pinChartToDashboard({ title, type, xKey, yKey, data, colors? }) — pin a chart to the dashboard the user is currently viewing. Call this AFTER query_project_warehouse (or execute_dataset_query). The data argument MUST be a JSON array STRING of the actual returned rows (e.g. '[{"brand":"X","total_deal_value":123}]') — never an empty array or placeholder. xKey/yKey must be column names present in those rows. CHOOSE the colors: pass a JSON array STRING of hex codes (e.g. '["#1565C0","#2E7D32","#E65100"]') that fit the data — distinct hues for categorical comparisons, a single hue for a single series, and red/green only where it conveys good/bad. Omit colors only if unsure.
Resolve names and indexes using the CURRENT PAGE context and the PROJECTS / DASHBOARDS lists provided as readable context. If projectId is omitted, use the project of the current page.

DATA QUESTIONS — act as the project's data analyst. Follow this ORDER:
STEP 1 — DISCOVER THE SCHEMA FIRST. Before any query, you MUST know the exact table and column names. If the PROJECT WAREHOUSE section below already lists them, use those. Otherwise (or if it's missing), call list_warehouse_tables and wait for the result BEFORE querying. NEVER guess or invent a table name (e.g. do not assume "deals" or "sales_data") — discover it.
STEP 2 — QUERY. Call query_project_warehouse with a single read-only SELECT using the real table/column names from step 1. Reference tables by bare name (the schema is on the search_path); join across tables/views as needed. If a query still errors with "does not exist", call list_warehouse_tables and retry with a corrected name.
STEP 3 — VISUALISE. Call pinChartToDashboard, passing the returned rows as a JSON array STRING in the data argument (pick a fitting type: bar for comparisons/rankings, line for time trends, pie/donut for composition), so the chart is pinned to the dashboard the user is viewing.

For questions about UPLOADED files (the UPLOADED DATASETS list), use execute_dataset_query instead. Never invent numbers — always base answers and charts on real query results, and never claim you lack the data without first discovering the schema and querying.`;

const ACTIONS_RESPONSE_RULES = `RESPONSE STYLE:
1. Be concise. Use **bold** for key entities, metrics, and important numbers.
2. Bullet points must each be on their own line (never inline).
3. When the user asks to "summarize" or "analyze", lead with a 1-2 sentence finding, then bullets with **bold** entities, then a short closing line.`;

// Cache the system prompt for 60 seconds to avoid a DB query on every chat message.
let _cache: { value: string; ts: number } | null = null;
let _copilotCache: { value: string; ts: number } | null = null;
const CACHE_TTL_MS = 5_000;

export function invalidateSystemPromptCache(): void {
  _cache = null;
  _copilotCache = null;
}

async function buildDatasetContext(): Promise<string> {
  try {
    const rows = await db
      .select()
      .from(datasetsTable)
      .orderBy(desc(datasetsTable.createdAt))
      .limit(10);

    if (rows.length === 0) return "";

    const lines = rows.map((d) => {
      const cols = (d.columnSchema as Array<{ originalName: string; pgName: string; type: string; pgType: string }>);
      const colList = cols
        .map((c) => `"${c.pgName}" ${c.pgType} (original: "${c.originalName}")`)
        .join(", ");
      return `- [datasetId=${d.id}, tableName="${d.tableName}"] "${d.fileName}" / sheet "${d.sheetName}" — ${d.rowCount} rows\n  SQL must use tableName="${d.tableName}" when calling with datasetId=${d.id}\n  Columns: ${colList}`;
    });

    return `UPLOADED DATASETS — call execute_dataset_query to answer questions about these.\nCRITICAL: each call must use the datasetId and tableName from the SAME entry below — never mix them across entries.\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}

export async function buildSystemPrompt(): Promise<string> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return _cache.value;
  }

  const config = getTenantConfig();
  const [dataContext, datasetContext] = await Promise.all([
    buildDataContext(),
    buildDatasetContext(),
  ]);

  const persona = interpolateBranding(config.prompt.persona, config);
  const dashboards = buildDashboardList(config);
  const terminology = buildTerminologyBlock(config);
  const fewShot = buildFewShotBlock(config);

  const parts = [
    persona,
    "",
    dataContext,
    "",
    datasetContext,
    "",
    `AVAILABLE DASHBOARDS:\n${dashboards}`,
    "",
    CHART_RULES,
    "",
    NAVIGATION_RULES,
    "",
    fewShot ? `EXAMPLES:\n${fewShot}` : "",
    "",
    RESPONSE_RULES,
    terminology ? `\n${terminology}` : "",
    `You have data from ${config.branding.dateRange}. Reference the most relevant periods.`,
  ];

  const value = parts.filter(Boolean).join('\n');
  _cache = { value, ts: Date.now() };
  return value;
}

/**
 * Base instructions for the CopilotKit right-rail Copilot. Reuses the tenant
 * persona, data/dataset context, and dashboard list, but swaps the legacy
 * token rules ([CHART:]/[NAVIGATE:]) for the interactive-actions rules — the
 * right rail now drives the app via real CopilotKit actions and renders charts
 * via the pinChartToDashboard action's generative UI. Per-project semantic
 * model + metric context is appended by the route (it depends on workspaceId).
 */
export async function buildCopilotInstructions(): Promise<string> {
  if (_copilotCache && Date.now() - _copilotCache.ts < CACHE_TTL_MS) {
    return _copilotCache.value;
  }

  const config = getTenantConfig();
  const [dataContext, datasetContext] = await Promise.all([
    buildDataContext(),
    buildDatasetContext(),
  ]);

  const persona = interpolateBranding(config.prompt.persona, config);
  const dashboards = buildDashboardList(config);
  const terminology = buildTerminologyBlock(config);
  const fewShot = buildFewShotBlock(config);

  const parts = [
    persona,
    "",
    dataContext,
    "",
    datasetContext,
    "",
    `AVAILABLE DASHBOARDS:\n${dashboards}`,
    "",
    ACTIONS_RULES,
    "",
    fewShot ? `EXAMPLES:\n${fewShot}` : "",
    "",
    ACTIONS_RESPONSE_RULES,
    terminology ? `\n${terminology}` : "",
    `You have data from ${config.branding.dateRange}. Reference the most relevant periods.`,
  ];

  const value = parts.filter(Boolean).join('\n');
  _copilotCache = { value, ts: Date.now() };
  return value;
}



