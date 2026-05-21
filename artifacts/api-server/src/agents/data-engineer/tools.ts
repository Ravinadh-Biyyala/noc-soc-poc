/**
 * DataEngineerAgent tool definitions.
 *
 * Per the new spec, the agent has four narrow tools:
 *   - get_schema_info        Metadata Extractor — column names + types from information_schema
 *   - profile_data           Lightweight COUNT / NULL / DISTINCT / MIN / MAX per column
 *   - propose_cleaning       Record a cleaning step the user can later accept
 *   - execute_transformation Run an accepted transformation against the warehouse
 *
 * The older tool names (inspect_raw_table, propose_transformation,
 * apply_transformation) are kept in the executor's switch dispatcher so legacy
 * /preview-prompt callers keep working during the refactor.
 */

import type { ProjectTransformation } from "@workspace/db";

export interface DataEngineerToolset {
  get_schema_info(args: { tableName: string }): Promise<SchemaInfoResult>;
  profile_data(args: { tableName: string }): Promise<RawTableProfile>;
  propose_cleaning(args: ProposeTransformationArgs): Promise<{ id: number }>;
  execute_transformation(args: { transformationId: number }): Promise<{ status: "applied"; targetTable: string }>;
}

export interface SchemaInfoResult {
  tableName: string;
  schema: string;
  columns: Array<{ name: string; type: string; nullable: boolean }>;
}

export interface RawTableProfile {
  tableName: string;
  schema: string;
  rowCount: number;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    nullCount?: number;
    distinctCount?: number;
    min?: string | null;
    max?: string | null;
    sample: unknown[];
  }>;
  sampleRows: Array<Record<string, unknown>>;
}

export interface ProposeTransformationArgs {
  kind: "cleanse" | "join" | "aggregate" | "view" | "rename";
  title: string;
  description: string;
  sourceTables: string[];
  sql: string;
  targetTableName: string;
  rationale: string;
}

/** OpenAI function-calling schema. New tool names; legacy names still dispatched. */
export const DATA_ENGINEER_OPENAI_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_schema_info",
      description: "Return column names, types, and nullability for a raw table via information_schema. Fast and cheap — call this before profile_data to pick which tables are worth deeper analysis.",
      parameters: {
        type: "object",
        properties: {
          tableName: { type: "string", description: "Table name within the project's raw schema. No schema prefix." },
        },
        required: ["tableName"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "profile_data",
      description: "Profile a raw table: row count, per-column null counts, distinct counts, min/max, and 5 sample rows. Use to spot anomalies before proposing cleansing.",
      parameters: {
        type: "object",
        properties: {
          tableName: { type: "string", description: "Table name within the project's raw schema. No schema prefix." },
        },
        required: ["tableName"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_cleaning",
      description: "Record a cleaning / join / aggregation proposal the user can later accept. Does NOT execute SQL — user review gates execution.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["cleanse", "join", "aggregate", "view", "rename"] },
          title: { type: "string", description: "Short human-readable title shown in the UI card." },
          description: { type: "string", description: "1–2 sentences the user can read to decide whether to accept." },
          sourceTables: { type: "array", items: { type: "string" }, description: "Raw or warehouse tables this transformation reads from." },
          sql: { type: "string", description: "Full SQL — must start with CREATE [OR REPLACE] VIEW / TABLE in the project warehouse schema." },
          targetTableName: { type: "string", description: "Name of the new view/table in the warehouse." },
          rationale: { type: "string", description: "Why this transformation helps the project's stated goal." },
        },
        required: ["kind", "title", "description", "sourceTables", "sql", "targetTableName", "rationale"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "execute_transformation",
      description: "Execute the SQL of an accepted transformation against the project's warehouse schema. Fails if the row is not in 'accepted' status.",
      parameters: {
        type: "object",
        properties: {
          transformationId: { type: "integer", description: "id of the row in project_transformations." },
        },
        required: ["transformationId"],
      },
    },
  },
];

export type { ProjectTransformation };
