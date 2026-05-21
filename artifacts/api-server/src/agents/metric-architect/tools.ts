/**
 * MetricArchitectAgent tool definitions.
 *
 * The Metric Architect defines business KPIs as SQL fragments stored in
 * project_metrics. Crucial constraint: it NEVER creates physical columns or
 * tables. A measure like Profit Margin = SUM(profit) / SUM(sales) is a runtime
 * aggregation — materialising it row-by-row would silently break aggregations
 * by Year/Region/etc.
 */

const READ_SEMANTIC_MODEL_TOOL = {
  type: "function" as const,
  function: {
    name: "read_semantic_model",
    description: "Return the applied semantic graph (facts, dimensions, joins) for this project. Use it to understand which tables hold measurable numbers vs descriptive attributes.",
    parameters: { type: "object", properties: {} },
  },
};

const LIST_WAREHOUSE_TOOL = {
  type: "function" as const,
  function: {
    name: "list_warehouse_tables",
    description: "List every table/view in the project's warehouse schema with column names and types. Useful for spotting numeric columns that probably back metrics.",
    parameters: { type: "object", properties: {} },
  },
};

const SUGGEST_METRICS_TOOL = {
  type: "function" as const,
  function: {
    name: "suggest_metrics",
    description: "Return a list of standard metric formulas that pattern-match against the warehouse's numeric columns. This is a hint pass — it does NOT save anything; the agent reviews the suggestions and decides which to persist via save_measure_metadata.",
    parameters: {
      type: "object",
      properties: {
        columnHints: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of column names (\"revenue\", \"cost\", etc.) to bias suggestions toward.",
        },
      },
    },
  },
};

const SAVE_MEASURE_METADATA_TOOL = {
  type: "function" as const,
  function: {
    name: "save_measure_metadata",
    description: "Persist a metric definition. The sqlFormula is a SQL FRAGMENT — it will be substituted into a SELECT clause at query time (e.g. \"SUM(revenue) - SUM(cost)\"). NEVER pass a full SQL statement, NEVER reference DROP/ALTER/INSERT, and NEVER attempt to create a physical column.",
    parameters: {
      type: "object",
      properties: {
        metricName: {
          type: "string",
          description: "snake_case identifier, e.g. \"net_revenue\". Becomes the {{metric:name}} key in Copilot queries.",
        },
        description: {
          type: "string",
          description: "1–2 sentences explaining what the metric measures and the business question it answers.",
        },
        sqlFormula: {
          type: "string",
          description: "SQL expression usable inside a SELECT — e.g. \"SUM(revenue) - SUM(cost)\" or \"SUM(profit) * 1.0 / NULLIF(SUM(sales),0)\". No DDL, no semicolons, no DROP/ALTER/INSERT/UPDATE/DELETE.",
        },
        dependsOnTables: {
          type: "array",
          items: { type: "string" },
          description: "Warehouse tables (table names only, not schema-qualified) whose columns this formula references.",
        },
        rationale: {
          type: "string",
          description: "Why this metric matters for the project goal.",
        },
      },
      required: ["metricName", "sqlFormula", "dependsOnTables"],
    },
  },
};

export const METRIC_ARCHITECT_OPENAI_TOOLS = [
  READ_SEMANTIC_MODEL_TOOL,
  LIST_WAREHOUSE_TOOL,
  SUGGEST_METRICS_TOOL,
  SAVE_MEASURE_METADATA_TOOL,
];
