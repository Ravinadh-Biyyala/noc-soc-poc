/**
 * One-shot migration: creates project_semantic_models, project_metrics,
 * and pipeline_checkpoints if they don't already exist.
 *
 * Run with:
 *   node --experimental-require-module scripts/migrate-new-tables.mjs
 * or simply:
 *   node scripts/migrate-new-tables.mjs
 *
 * DATABASE_URL is loaded from .env automatically.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Load .env
const envFile = resolve(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

// Resolve pg from the api-server package which has it as a dependency
const req = createRequire(resolve(root, "artifacts/api-server/package.json"));
const pg = req("pg");
const pool = new pg.Pool({ connectionString: url });

const sql = `
CREATE TABLE IF NOT EXISTS project_semantic_models (
  id               serial PRIMARY KEY,
  workspace_id     integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status           varchar(32) NOT NULL DEFAULT 'proposed',
  graph_definition jsonb NOT NULL,
  agent_rationale  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_metrics (
  id                serial PRIMARY KEY,
  workspace_id      integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  metric_name       varchar(128) NOT NULL,
  description       text,
  sql_formula       text NOT NULL,
  depends_on_tables jsonb NOT NULL DEFAULT '[]',
  status            varchar(32) NOT NULL DEFAULT 'proposed',
  agent_rationale   text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pipeline_checkpoints (
  id            serial PRIMARY KEY,
  workspace_id  integer NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  thread_id     varchar(128) NOT NULL,
  state         jsonb NOT NULL,
  current_phase varchar(64) NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pipeline_checkpoints_thread_idx
  ON pipeline_checkpoints(workspace_id, thread_id);
`;

try {
  await pool.query(sql);
  console.log("✓ Tables created (or already exist):");
  console.log("  - project_semantic_models");
  console.log("  - project_metrics");
  console.log("  - pipeline_checkpoints");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exit(1);
} finally {
  await pool.end();
}
