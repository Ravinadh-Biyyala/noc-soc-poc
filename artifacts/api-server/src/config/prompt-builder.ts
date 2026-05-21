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

// Cache the system prompt for 60 seconds to avoid a DB query on every chat message.
let _cache: { value: string; ts: number } | null = null;
const CACHE_TTL_MS = 5_000;

export function invalidateSystemPromptCache(): void {
  _cache = null;
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



