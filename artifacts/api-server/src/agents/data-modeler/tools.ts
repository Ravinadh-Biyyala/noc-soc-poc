/**
 * DataModelerAgent tool definitions.
 *
 * Per the new spec, the modeler is a SEMANTIC layer — it never issues DDL.
 * It analyses the warehouse and emits a single graphDefinition object capturing
 * facts, dimensions, and joins. The downstream Metric Architect reads this
 * graph to position metric formulas correctly.
 *
 * Three tool sets:
 *   SEMANTIC_MODEL_TOOLS  — list_warehouse_tables + propose_star_schema + generate_semantic_graph
 *   DASHBOARD_TOOLS       — list_warehouse_tables + execute_warehouse_query + create_dashboard
 *                            (used by the separate /generate-dashboard route)
 *   RELATIONSHIPS_TOOLS   — legacy alias; kept so the old route compiles until it's migrated.
 */

const LIST_TABLES_TOOL = {
  type: "function" as const,
  function: {
    name: "list_warehouse_tables",
    description: "List every table/view in the project's warehouse schema with column names and types.",
    parameters: { type: "object", properties: {} },
  },
};

const EXECUTE_QUERY_TOOL = {
  type: "function" as const,
  function: {
    name: "execute_warehouse_query",
    description: "Run a SELECT against the project's warehouse schema. Returns up to 200 rows.",
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string", description: "Fully-qualified SELECT or WITH ... SELECT against the project's warehouse schema." },
      },
      required: ["sql"],
    },
  },
};

const PROPOSE_STAR_SCHEMA_TOOL = {
  type: "function" as const,
  function: {
    name: "propose_star_schema",
    description: "Classify each warehouse table as a FACT (transactional / event-style) or DIMENSION (descriptive / lookup). Call once after inspecting all tables. The classification feeds into generate_semantic_graph.",
    parameters: {
      type: "object",
      properties: {
        facts:      { type: "array", items: { type: "string" }, description: "Table names classified as Fact tables." },
        dimensions: { type: "array", items: { type: "string" }, description: "Table names classified as Dimension tables." },
        rationale:  { type: "string", description: "1-2 sentences explaining the classification." },
      },
      required: ["facts", "dimensions", "rationale"],
    },
  },
};

const GENERATE_SEMANTIC_GRAPH_TOOL = {
  type: "function" as const,
  function: {
    name: "generate_semantic_graph",
    description: "Persist the project's semantic graph (facts, dimensions, joins). Does NOT alter any physical table. The graph is the routing metadata downstream agents and the BI Copilot use to write correct JOINs.",
    parameters: {
      type: "object",
      properties: {
        facts:      { type: "array", items: { type: "string" } },
        dimensions: { type: "array", items: { type: "string" } },
        joins: {
          type: "array",
          items: {
            type: "object",
            properties: {
              from:        { type: "string", description: "Fully-qualified source: \"<table>.<column>\"." },
              to:          { type: "string", description: "Fully-qualified target: \"<table>.<column>\"." },
              cardinality: { type: "string", enum: ["1:1", "1:N", "N:1", "N:N"] },
            },
            required: ["from", "to", "cardinality"],
          },
        },
        rationale: { type: "string", description: "1-3 sentences on why this graph fits the project goal." },
      },
      required: ["facts", "dimensions", "joins", "rationale"],
    },
  },
};

const CREATE_DASHBOARD_TOOL = {
  type: "function" as const,
  function: {
    name: "create_dashboard",
    description: "Persist a dashboard (title + charts) scoped to this project. Each chart's config matches ChartConfig used by GeneratedDashboard.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        charts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              chartType: {
                type: "string",
                description: "One of: bar | horizontal-bar | stacked-bar | line | area | pie | donut | scatter | bubble | combo | funnel | radar | treemap | histogram | bullet | waterfall | heatmap | progress-bar | gauge | kpi | table",
              },
              config: {
                type: "object",
                description: "Chart config. MUST include: sql (the exact SELECT you ran for this chart), xKey (column name for X axis), yKey (column name(s) for Y axis), data (the rows returned by that SELECT). For kpi chartType: { sql, value, subtitle?, trend? }.",
                properties: {
                  sql:   { type: "string", description: "The fully-qualified SELECT statement you used to query this chart's data." },
                  xKey:  { type: "string", description: "Column name for the X-axis (omit for kpi/table)." },
                  yKey:  { description: "Column name(s) for the Y-axis. String for single series, array for multi-series.", oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
                  data:  { type: "array", description: "Row objects returned by the SQL query." },
                },
                required: ["sql"],
              },
            },
            required: ["title", "chartType", "config"],
          },
        },
      },
      required: ["title", "charts"],
    },
  },
};

/** Phase 2 — semantic-model pass (new). */
export const DATA_MODELER_SEMANTIC_TOOLS = [
  LIST_TABLES_TOOL,
  PROPOSE_STAR_SCHEMA_TOOL,
  GENERATE_SEMANTIC_GRAPH_TOOL,
];

/** Dashboard generation pass (kept). */
export const DATA_MODELER_DASHBOARD_TOOLS = [
  LIST_TABLES_TOOL,
  EXECUTE_QUERY_TOOL,
  CREATE_DASHBOARD_TOOL,
];

/** @deprecated — use DATA_MODELER_SEMANTIC_TOOLS. Kept to keep legacy route compiling. */
export const DATA_MODELER_RELATIONSHIPS_TOOLS = DATA_MODELER_SEMANTIC_TOOLS;

/** Back-compat union (used by /preview-prompt). */
export const DATA_MODELER_OPENAI_TOOLS = [
  LIST_TABLES_TOOL,
  EXECUTE_QUERY_TOOL,
  PROPOSE_STAR_SCHEMA_TOOL,
  GENERATE_SEMANTIC_GRAPH_TOOL,
  CREATE_DASHBOARD_TOOL,
];
