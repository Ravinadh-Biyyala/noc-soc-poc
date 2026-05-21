/**
 * Per-project schema isolation.
 *
 * Each workspace gets two dedicated Postgres SCHEMAS inside the master DB:
 *   - proj_{id}_raw       — landing zone for ingested data
 *   - proj_{id}_warehouse — curated tables/views produced by accepted
 *                           transformations
 *
 * The previous design provisioned a separate physical DATABASE per workspace,
 * which exhausts Postgres connection slots (default 100) once you cross
 * ~20–30 active workspaces. Funneling all traffic through the single master
 * pool removes that ceiling.
 */
import { sql } from "drizzle-orm";
import { db, pool as masterPool } from "./index";

export type SchemaLayer = "raw" | "warehouse";

export function getProjectDatabaseName(projectId: number): string {
  // Back-compat with code that still asks for a "database name". Now returns
  // the raw schema prefix since there's no per-project DB anymore.
  assertValidProjectId(projectId);
  return `proj_${projectId}`;
}

export function rawSchema(projectId: number): string {
  assertValidProjectId(projectId);
  return `proj_${projectId}_raw`;
}

export function warehouseSchema(projectId: number): string {
  assertValidProjectId(projectId);
  return `proj_${projectId}_warehouse`;
}

export function getProjectSchemaName(projectId: number, layer: SchemaLayer): string {
  return layer === "raw" ? rawSchema(projectId) : warehouseSchema(projectId);
}

function assertValidProjectId(projectId: number) {
  if (!Number.isFinite(projectId) || projectId <= 0 || !Number.isInteger(projectId)) {
    throw new Error(`Invalid projectId: ${projectId}`);
  }
}

/**
 * Quotes a schema-qualified identifier safely. We construct the identifier
 * ourselves because Postgres does not parameterise identifiers. projectId is
 * validated as an integer above, and table/column names from callers are
 * sanitized at the ingest layer.
 */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Provisions the per-project raw + warehouse schemas inside the master DB.
 * Idempotent — re-running on an existing workspace is a no-op.
 */
export async function createProjectSchemas(projectId: number): Promise<{ raw: string; warehouse: string; created: boolean }> {
  const raw = rawSchema(projectId);
  const warehouse = warehouseSchema(projectId);

  const existsResult = await masterPool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.schemata WHERE schema_name = $1
    ) AS exists`,
    [raw],
  );
  const alreadyExists = existsResult.rows[0]?.exists ?? false;

  await masterPool.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(raw)}`);
  await masterPool.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(warehouse)}`);

  return { raw, warehouse, created: !alreadyExists };
}

/** Drops both per-project schemas. CASCADE drops every contained object. */
export async function dropProjectSchemas(projectId: number): Promise<void> {
  const raw = rawSchema(projectId);
  const warehouse = warehouseSchema(projectId);
  await masterPool.query(`DROP SCHEMA IF EXISTS ${quoteIdent(raw)} CASCADE`);
  await masterPool.query(`DROP SCHEMA IF EXISTS ${quoteIdent(warehouse)} CASCADE`);
}

// ---------------------------------------------------------------------------
// Back-compat aliases for callers that still use the old DB-per-tenant names.
// They now delegate to the schema-per-tenant implementation.
// ---------------------------------------------------------------------------

/** @deprecated Use createProjectSchemas. */
export async function createProjectDatabase(projectId: number): Promise<{ database: string; created: boolean }> {
  const result = await createProjectSchemas(projectId);
  return { database: `proj_${projectId}`, created: result.created };
}

/** @deprecated Use dropProjectSchemas. */
export async function dropProjectDatabase(projectId: number): Promise<void> {
  return dropProjectSchemas(projectId);
}

/**
 * @deprecated The per-project pool no longer exists. Callers should use the
 * shared `pool` exported from `./index` (or the Drizzle `db`) and qualify
 * table references with `rawSchema(id)` / `warehouseSchema(id)`. This stub is
 * kept so that legacy call sites compile during the refactor; it returns the
 * master pool so .query() calls keep working as long as the caller has
 * schema-qualified their table names.
 */
export function getProjectPool(_projectId: number): typeof masterPool {
  return masterPool;
}

// ---------------------------------------------------------------------------
// Introspection — runs against the master DB, filtering by the per-project
// schema name.
// ---------------------------------------------------------------------------

interface SchemaTableRow {
  table_name: string;
  row_count: string;
}

async function listTablesInSchema(schemaName: string) {
  const result = await masterPool.query<SchemaTableRow>(
    `SELECT
      c.relname AS table_name,
      COALESCE(c.reltuples, 0)::bigint AS row_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
      AND c.relkind IN ('r', 'v', 'm')
    ORDER BY c.relname`,
    [schemaName],
  );
  return result.rows.map((r) => ({ tableName: r.table_name, rowCount: Number(r.row_count) }));
}

export async function listRawTables(projectId: number) {
  return listTablesInSchema(rawSchema(projectId));
}

export async function listWarehouseTables(projectId: number) {
  return listTablesInSchema(warehouseSchema(projectId));
}

export async function countWarehouseTables(projectId: number): Promise<number> {
  const rows = await listWarehouseTables(projectId);
  return rows.length;
}

export async function countRawTables(projectId: number): Promise<number> {
  const rows = await listRawTables(projectId);
  return rows.length;
}

export { masterPool, db, sql };
