import { getTenantConfig, buildDataContext } from "./index.js";
import type { TenantConfig } from "./types.js";

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

const CHART_RULES = `CRITICAL RULE — GENERATIVE BI CHARTS:
When a user asks ANY data question (numbers, trends, comparisons, breakdowns, etc.), you MUST generate an inline chart visualization. Use this exact format:

[CHART:{"type":"bar|line|area|pie","title":"Chart Title","xKey":"labelField","yKey":"valueField","data":[{"labelField":"Label1","valueField":123},{"labelField":"Label2","valueField":456}]}]

Chart types to use:
- "bar" for comparisons (entity vs entity, segment vs segment)
- "line" or "area" for trends over time (monthly, quarterly data)
- "pie" for composition/mix (portfolio breakdown, segment share)

IMPORTANT CHART RULES:
1. ALWAYS include a [CHART:...] block when the user asks about data. This is Gen-BI — every data question gets a visualization.
2. Use real data from the context above. Never make up numbers.
3. For monetary values, provide raw numbers (not formatted strings) in the data array. The frontend will format them.
4. The xKey and yKey must match the keys in your data objects exactly.
5. Keep data arrays concise (max 12-15 data points for readability).
6. Add a brief text insight BEFORE the chart (1-2 sentences max).
7. After the chart, you can add [NAVIGATE:/route] if there's a relevant dashboard.`;

const RESPONSE_RULES = `ADDITIONAL RESPONSE RULES:
1. Use **bold** for key metrics.
2. Keep text concise — the chart IS the answer.
3. For navigation, include [NAVIGATE:/route] after the chart.
4. When the user asks to "Summarize" or "Analyze" a specific metric (these are auto-triggered from clicking a KPI card), give a SHORT 2-3 sentence insight with 1-2 bold key facts, then a small chart showing the trend or breakdown. Keep it concise — this is a quick tooltip-style summary, not a full analysis.
6. If asked about a specific time range, filter the data and build the chart from it.`;

export async function buildSystemPrompt(): Promise<string> {
  const config = getTenantConfig();
  const dataContext = await buildDataContext();

  const persona = interpolateBranding(config.prompt.persona, config);
  const dashboards = buildDashboardList(config);
  const terminology = buildTerminologyBlock(config);
  const fewShot = buildFewShotBlock(config);

  const parts = [
    persona,
    "",
    dataContext,
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

  return parts.filter(Boolean).join('\n');
}
