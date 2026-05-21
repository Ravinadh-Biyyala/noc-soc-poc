/**
 * Concrete tool implementations for DataEngineerAgent.
 *
 * Each function maps to a tool name in DATA_ENGINEER_OPENAI_TOOLS. The
 * project-transformations route builds an executor by closing over the
 * projectId + logger and dispatching by tool name.
 */
import {
  db,
  projectTransformations,
  rawSchema,
  warehouseSchema,
  masterPool,
  quoteIdent,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  assertTransformationSql,
  ddlKindForTransformation,
  normalizeTransformationDdl,
} from "../shared/validation";
import type { AgentToolCall } from "../shared/runner";
import type pino from "pino";

interface RawColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: string;
}

/** Tool 1 — Metadata Extractor. Returns column info via information_schema. */
export async function getSchemaInfo(projectId: number, tableName: string) {
  const schema = rawSchema(projectId);
  const colsResult = await masterPool.query<RawColumnRow>(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, tableName],
  );
  if (colsResult.rows.length === 0) {
    return { error: `Table ${schema}.${tableName} not found.` };
  }
  return {
    tableName,
    schema,
    columns: colsResult.rows.map((c) => ({
      name: c.column_name,
      type: c.data_type,
      nullable: c.is_nullable === "YES",
    })),
  };
}

/** Tool 2 — Profiler. Lightweight COUNT / NULL / DISTINCT / MIN / MAX per column. */
export async function profileData(projectId: number, tableName: string) {
  const schema = rawSchema(projectId);
  const qualified = `${quoteIdent(schema)}.${quoteIdent(tableName)}`;

  const colsResult = await masterPool.query<RawColumnRow>(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, tableName],
  );
  if (colsResult.rows.length === 0) {
    return { error: `Table ${schema}.${tableName} not found.` };
  }

  const countResult = await masterPool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${qualified}`,
  );
  const rowCount = Number(countResult.rows[0]?.count ?? 0);

  const sampleResult = await masterPool.query(`SELECT * FROM ${qualified} LIMIT 5`);

  const profileSql = colsResult.rows
    .slice(0, 12)
    .map((c, i) => {
      const col = quoteIdent(c.column_name);
      // MIN/MAX only on types where comparison makes sense; otherwise NULL.
      const isComparable = !/json|jsonb|xml/i.test(c.data_type);
      const minMax = isComparable
        ? `MIN(${col})::text AS min${i}, MAX(${col})::text AS max${i}`
        : `NULL::text AS min${i}, NULL::text AS max${i}`;
      return `COUNT(*) FILTER (WHERE ${col} IS NULL) AS n${i}, COUNT(DISTINCT ${col}) AS d${i}, ${minMax}`;
    })
    .join(", ");

  let profileRow: Record<string, string> = {};
  if (profileSql) {
    const profileResult = await masterPool.query<Record<string, string>>(
      `SELECT ${profileSql} FROM ${qualified}`,
    );
    profileRow = profileResult.rows[0] ?? {};
  }

  const columns = colsResult.rows.map((c, i) => {
    const profiled = i < 12;
    const sample = sampleResult.rows
      .map((r) => (r as Record<string, unknown>)[c.column_name])
      .slice(0, 3);
    return {
      name: c.column_name,
      type: c.data_type,
      nullable: c.is_nullable === "YES",
      nullCount: profiled ? Number(profileRow[`n${i}`] ?? 0) : undefined,
      distinctCount: profiled ? Number(profileRow[`d${i}`] ?? 0) : undefined,
      min: profiled ? profileRow[`min${i}`] ?? null : undefined,
      max: profiled ? profileRow[`max${i}`] ?? null : undefined,
      sample,
    };
  });

  return { tableName, schema, rowCount, columns, sampleRows: sampleResult.rows };
}

/** Back-compat: older preview-prompt code calls inspectRawTable. */
export async function inspectRawTable(projectId: number, tableName: string) {
  return profileData(projectId, tableName);
}

export interface ProposeTransformationArgs {
  kind: string;
  title: string;
  description: string;
  sourceTables: string[];
  sql: string;
  targetTableName: string;
  rationale: string;
}

export async function proposeTransformation(projectId: number, args: ProposeTransformationArgs) {
  const warehouse = warehouseSchema(projectId);
  const expectedDdl = ddlKindForTransformation(args.kind);

  const normalizedSql = normalizeTransformationDdl(args.sql, expectedDdl);

  try {
    assertTransformationSql(normalizedSql, warehouse, expectedDdl);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid SQL" };
  }

  const [row] = await db
    .insert(projectTransformations)
    .values({
      projectId,
      kind: args.kind,
      title: args.title,
      description: args.description,
      sourceTables: args.sourceTables,
      sql: normalizedSql,
      targetTableName: args.targetTableName,
      status: "proposed",
      agentRationale: args.rationale,
    })
    .returning();

  return { id: row.id, status: row.status };
}

/** Back-compat alias. */
export const proposeCleaning = proposeTransformation;

/** Checks if a table exists in the project warehouse schema. */
async function warehouseTableExists(projectId: number, tableName: string): Promise<boolean> {
  const result = await masterPool.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = $2
     ) AS exists`,
    [warehouseSchema(projectId), tableName],
  );
  return result.rows[0]?.exists === true;
}

/** Returns the first proposed/accepted transformation that creates `tableName`. */
async function findProducer(projectId: number, tableName: string) {
  const rows = await db
    .select()
    .from(projectTransformations)
    .where(and(
      eq(projectTransformations.projectId, projectId),
      eq(projectTransformations.targetTableName, tableName),
    ));
  return rows.find((r) => r.status === "proposed" || r.status === "accepted") ?? null;
}

/**
 * Executes a transformation against the project's warehouse schema. Runs in a
 * transaction so a failed CREATE doesn't leave a half-built target around.
 *
 * Auto-applies upstream warehouse dependencies in topological order: if a
 * source table lives in this project's warehouse schema but doesn't exist yet,
 * the producing transformation (if one is proposed/accepted) is applied first.
 * The `dependenciesApplied` field in the result lists their target-table names.
 */
export async function applyTransformation(
  projectId: number,
  transformationId: number,
  _depth = 0,
): Promise<{ status: string; targetTable: string; ddl?: string; dependenciesApplied?: string[] } | { error: string }> {
  if (_depth > 5) return { error: "Dependency chain too deep — possible cycle in proposed transformations." };

  const [row] = await db
    .select()
    .from(projectTransformations)
    .where(and(eq(projectTransformations.id, transformationId), eq(projectTransformations.projectId, projectId)))
    .limit(1);

  if (!row) return { error: `Transformation ${transformationId} not found in project ${projectId}` };
  if (row.status === "applied") return { status: "applied", targetTable: row.targetTableName };

  const warehouse = warehouseSchema(projectId);

  // Resolve upstream dependencies: for each source table that looks like a
  // warehouse table (schema matches or unqualified) and doesn't exist yet,
  // find and apply its producer first.
  const dependenciesApplied: string[] = [];
  for (const src of ((row.sourceTables as string[]) ?? [])) {
    // Extract just the table name from "schema.table" or plain "table"
    const parts = src.split(".");
    const srcSchema = parts.length > 1 ? parts.slice(0, -1).join(".") : null;
    const tableName = parts[parts.length - 1];

    // Skip raw-schema sources — they come from ingestion, not transformations
    if (srcSchema && srcSchema.toLowerCase().includes("_raw")) continue;
    if (srcSchema && srcSchema.toLowerCase() === "raw") continue;

    // Check if this is referencing our warehouse (qualified or unqualified)
    const isWarehouse =
      !srcSchema ||
      srcSchema.toLowerCase() === warehouse.toLowerCase() ||
      srcSchema.toLowerCase() === "warehouse";

    if (!isWarehouse) continue;

    const exists = await warehouseTableExists(projectId, tableName);
    if (exists) continue;

    const producer = await findProducer(projectId, tableName);
    if (!producer) continue; // let SQL fail naturally with the Postgres error

    // Mark producer accepted if still proposed, then apply recursively
    if (producer.status === "proposed") {
      await db
        .update(projectTransformations)
        .set({ status: "accepted" })
        .where(eq(projectTransformations.id, producer.id));
    }
    const depResult = await applyTransformation(projectId, producer.id, _depth + 1);
    if ("error" in depResult) {
      return { error: `Dependency "${tableName}" failed to apply: ${depResult.error}` };
    }
    dependenciesApplied.push(tableName);
  }

  const expectedDdl = ddlKindForTransformation(row.kind);
  const normalizedSql = normalizeTransformationDdl(row.sql, expectedDdl);
  try {
    assertTransformationSql(normalizedSql, warehouse, expectedDdl);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid stored SQL" };
  }

  // Strip OR REPLACE from views: even after DROP TABLE IF EXISTS, Postgres
  // refuses CREATE OR REPLACE VIEW when the relation was previously a table
  // (pg internally tracks the relkind). Plain CREATE VIEW always works after
  // the DROP because no prior relation exists at that point.
  const execSql = normalizedSql.replace(/\bCREATE\s+OR\s+REPLACE\s+VIEW\b/i, "CREATE VIEW");

  const client = await masterPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DROP VIEW IF EXISTS ${quoteIdent(warehouse)}.${quoteIdent(row.targetTableName)} CASCADE`);
    await client.query(`DROP MATERIALIZED VIEW IF EXISTS ${quoteIdent(warehouse)}.${quoteIdent(row.targetTableName)} CASCADE`);
    await client.query(`DROP TABLE IF EXISTS ${quoteIdent(warehouse)}.${quoteIdent(row.targetTableName)} CASCADE`);
    await client.query(execSql);
    await client.query("COMMIT");
    await db
      .update(projectTransformations)
      .set({ status: "applied", appliedAt: new Date(), sql: normalizedSql })
      .where(eq(projectTransformations.id, transformationId));
    return {
      status: "applied",
      targetTable: row.targetTableName,
      ddl: expectedDdl,
      ...(dependenciesApplied.length > 0 && { dependenciesApplied }),
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return { error: err instanceof Error ? err.message : "Execution failed" };
  } finally {
    client.release();
  }
}

/** Back-compat alias matching the spec's tool name. */
export const executeTransformation = applyTransformation;

/**
 * Dispatcher matching the OpenAI tool-name contract in tools.ts. Used as the
 * `executeTool` callback by the shared agent runner.
 */
export function makeDataEngineerExecutor(projectId: number, log: pino.Logger) {
  return async (call: AgentToolCall): Promise<string> => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(call.arguments || "{}");
    } catch {
      return JSON.stringify({ error: "Could not parse tool arguments as JSON." });
    }

    switch (call.name) {
      case "get_schema_info": {
        const tableName = String(parsed.tableName ?? "");
        if (!tableName) return JSON.stringify({ error: "tableName is required" });
        log.info({ projectId, tool: "get_schema_info", tableName }, "data-engineer tool");
        const result = await getSchemaInfo(projectId, tableName).catch((err) => ({ error: String(err) }));
        return JSON.stringify(result);
      }
      case "profile_data":
      // back-compat alias used by the previous prompt
      case "inspect_raw_table": {
        const tableName = String(parsed.tableName ?? "");
        if (!tableName) return JSON.stringify({ error: "tableName is required" });
        log.info({ projectId, tool: "profile_data", tableName }, "data-engineer tool");
        const result = await profileData(projectId, tableName).catch((err) => ({ error: String(err) }));
        return JSON.stringify(result);
      }
      case "propose_cleaning":
      case "propose_transformation": {
        log.info({ projectId, tool: "propose_cleaning", title: parsed.title }, "data-engineer tool");
        const result = await proposeTransformation(projectId, parsed as unknown as ProposeTransformationArgs).catch((err) => ({ error: String(err) }));
        return JSON.stringify(result);
      }
      case "execute_transformation":
      case "apply_transformation": {
        const tid = Number(parsed.transformationId);
        if (!Number.isFinite(tid)) return JSON.stringify({ error: "transformationId is required" });
        log.info({ projectId, tool: "execute_transformation", tid }, "data-engineer tool");
        const result = await applyTransformation(projectId, tid).catch((err) => ({ error: String(err) }));
        return JSON.stringify(result);
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${call.name}` });
    }
  };
}
