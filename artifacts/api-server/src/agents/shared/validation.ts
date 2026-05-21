/**
 * SQL validators used by all agent tools that execute generated SQL.
 *
 * Defence in depth: the system prompt tells the model what's allowed, this
 * runtime check enforces it. Per-agent tools wrap these validators around
 * every model-generated SQL string BEFORE it reaches pg.
 */

const SELECT_ONLY = /^\s*(WITH\s|SELECT\s)/i;
const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|CREATE|MERGE|COPY|VACUUM|ANALYZE)\b/i;

export function assertSelectOnly(sql: string): void {
  if (!SELECT_ONLY.test(sql)) {
    throw new Error("Only SELECT (or WITH ... SELECT) statements are allowed.");
  }
  if (FORBIDDEN.test(sql)) {
    throw new Error("SQL contains a forbidden DDL/DML keyword. Only SELECT is allowed.");
  }
}

/**
 * Verifies that the SQL only references tables in the allowed schemas. This
 * is a heuristic (looks for `"schema"."table"` and `schema.table` patterns);
 * the canonical defence is running the query under a Postgres role that has
 * SELECT permission only on the project's schemas, which the per-agent runner
 * does via SET search_path + a least-privilege role (see deferred work).
 */
export function assertSchemaScope(sql: string, allowedSchemas: ReadonlyArray<string>): void {
  const allowed = new Set(allowedSchemas.map((s) => s.toLowerCase()));
  const matches = sql.matchAll(/(?:"([a-z0-9_]+)"|([a-z0-9_]+))\s*\.\s*(?:"[a-z0-9_]+"|[a-z0-9_]+)/gi);
  for (const m of matches) {
    const schema = (m[1] ?? m[2] ?? "").toLowerCase();
    if (schema && !allowed.has(schema)) {
      throw new Error(`SQL references schema "${schema}" which is not allowed for this project. Allowed: ${[...allowed].join(", ")}.`);
    }
  }
}

/**
 * For DDL-emitting transformation SQL, allow CREATE OR REPLACE VIEW and
 * CREATE TABLE ... AS SELECT scoped to a single allowed warehouse schema.
 * Used by DataEngineerAgent.apply_transformation.
 */
const TRANSFORM_ALLOWED = /^\s*CREATE\s+(OR\s+REPLACE\s+)?(VIEW|TABLE|MATERIALIZED\s+VIEW)\s+/i;

export type TransformationDdlKind = "table" | "view";

/**
 * Maps the agent's `kind` field to the DDL kind we expect:
 *   cleanse / join / rename            → physical TABLE
 *   aggregate / filter / view          → VIEW (always live)
 * Anything else falls back to VIEW (safer — no materialisation surprise).
 */
export function ddlKindForTransformation(kind: string): TransformationDdlKind {
  const k = kind.toLowerCase();
  if (k === "cleanse" || k === "join" || k === "rename") return "table";
  return "view";
}

export function assertTransformationSql(
  sql: string,
  warehouseSchema: string,
  expectedDdl?: TransformationDdlKind,
): void {
  if (!TRANSFORM_ALLOWED.test(sql)) {
    throw new Error("Transformation SQL must start with CREATE [OR REPLACE] VIEW / TABLE / MATERIALIZED VIEW.");
  }
  if (/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bGRANT\b|\bREVOKE\b|\bALTER\b/i.test(sql)) {
    throw new Error("Transformation SQL contains a forbidden destructive keyword.");
  }
  // First quoted identifier after CREATE ... must be the target warehouse schema.
  // The schema name is now per-project (proj_{id}_warehouse), so we match the
  // longer identifier pattern instead of the literal "warehouse".
  const head = sql.match(/CREATE\s+(OR\s+REPLACE\s+)?(VIEW|TABLE|MATERIALIZED\s+VIEW)\s+"?([a-z0-9_]+)"?\s*\.\s*"?[a-z0-9_]+"?/i);
  if (!head) {
    throw new Error(`Transformation SQL must use a fully-qualified target like "${warehouseSchema}"."my_view".`);
  }
  const ddl = head[2].toUpperCase().startsWith("VIEW") || head[2].toUpperCase().includes("MATERIALIZED")
    ? "view"
    : "table";
  if (head[3].toLowerCase() !== warehouseSchema.toLowerCase()) {
    throw new Error(`Transformation must target schema "${warehouseSchema}", got "${head[3]}".`);
  }
  if (expectedDdl && ddl !== expectedDdl) {
    throw new Error(
      `This transformation should produce a ${expectedDdl.toUpperCase()} (per its kind), but the SQL creates a ${ddl.toUpperCase()}.`,
    );
  }
}

/**
 * Rewrites the head of a CREATE statement so the DDL kind matches what the
 * transformation `kind` says it should be. Used on apply to make older
 * proposals still runnable after the rule change — e.g. an aggregate that
 * was originally written as CREATE TABLE gets normalised to CREATE OR REPLACE VIEW.
 *
 * Returns the (possibly rewritten) SQL.
 */
export function normalizeTransformationDdl(
  sql: string,
  expectedDdl: TransformationDdlKind,
): string {
  const match = sql.match(/^(\s*)CREATE\s+(OR\s+REPLACE\s+)?(VIEW|TABLE|MATERIALIZED\s+VIEW)(\s+)/i);
  if (!match) return sql;
  const [whole, leading, , kind] = match;
  const currentDdl = kind.toUpperCase().includes("VIEW") ? "view" : "table";
  if (currentDdl === expectedDdl) return sql;

  const replacement = expectedDdl === "view"
    ? `${leading}CREATE OR REPLACE VIEW `
    : `${leading}CREATE TABLE `;

  let rewritten = sql.replace(whole, replacement);

  // CREATE TABLE needs an "AS" before the SELECT — if we're rewriting a VIEW
  // (which has its own "AS") to a TABLE, the AS is already there. Going the
  // other direction, "CREATE OR REPLACE VIEW ... AS SELECT" is also fine.
  // But "CREATE TABLE ... SELECT" (missing AS) needs fixing if the original
  // was a view-style statement. We detect that by checking for "AS\s+SELECT".
  if (!/\bAS\s+SELECT/i.test(rewritten) && /\bSELECT\b/i.test(rewritten)) {
    rewritten = rewritten.replace(/\)\s*SELECT/i, ") AS SELECT").replace(/"\s+SELECT/i, '" AS SELECT');
  }
  return rewritten;
}
