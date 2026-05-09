/**
 * Deterministic data-quality rules engine.
 *
 * Mirrors the kind of profile-on-ingest pass that Tableau Prep,
 * Databricks AutoLoader / DLT expectations, and Power Query do under
 * the hood — but exposed as small, configurable functions so the
 * right-rail Copilot can run them client-side immediately after an
 * upload and tell the user what it found.
 *
 * Every rule:
 *   - is pure and side-effect-free (safe to run repeatedly)
 *   - returns evidence (counts + a few sample rows) the chat can quote
 *   - takes a config object with sensible industry-standard defaults
 *     so the operator can tighten/loosen thresholds per tenant
 *
 * Nothing here mutates the source data. The agent proposes a fix; the
 * caller decides whether to materialise it.
 */

export type Row = Record<string, unknown>;

export interface DataQualityConfig {
  /** Rows above this null-rate (0..1) on a column trigger a "missing values" finding. */
  nullRateThreshold: number;
  /** Z-score above which a numeric value is flagged as an outlier. */
  outlierZScore: number;
  /** Min unique-rate (0..1) for a column to be considered a candidate primary key. */
  pkMinUniqueRate: number;
  /** Max % of rows that can be duplicates before we surface a "dedupe" finding. */
  dedupeRateThreshold: number;
  /** Max % of malformed values in an inferred-type column before we surface a "coerce" finding. */
  coerceRateThreshold: number;
}

export const DEFAULT_DQ_CONFIG: DataQualityConfig = {
  nullRateThreshold: 0.05, // 5% — Tableau Prep default-ish
  outlierZScore: 3, // 3σ — standard
  pkMinUniqueRate: 0.98,
  dedupeRateThreshold: 0.001, // 0.1% — anything above is worth surfacing
  coerceRateThreshold: 0.02, // 2% — Power Query "Detect data type" behaviour
};

export type DqSeverity = "info" | "warn" | "critical";

export interface DqFinding {
  /** Stable id so re-running doesn't duplicate a suggestion. */
  id: string;
  rule:
    | "missing-values"
    | "type-coercion"
    | "duplicate-rows"
    | "outliers"
    | "join-candidate";
  severity: DqSeverity;
  /** Short human-friendly headline ("47 malformed dates in `order_date`"). */
  title: string;
  /** One-line rationale citing the rule + evidence. */
  rationale: string;
  /** Verb the Apply button should use ("Coerce to date", "Drop 12 duplicates"). */
  applyLabel: string;
  /** Affected column(s) / table(s) — for downstream materialisation. */
  scope: { table?: string; columns?: string[]; otherTable?: string };
  /** Counts the chat can quote. */
  evidence: { count: number; total: number; sample?: unknown[] };
}

// ---------------------------------------------------------------------------
// Type inference helpers (parallel to backend, but kept dependency-free here
// so the engine runs purely in the browser).
// ---------------------------------------------------------------------------

const NUMERIC_RE = /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/;
const DATE_HINT_RE = /^\d{4}-\d{2}-\d{2}|^\d{1,2}\/\d{1,2}\/\d{2,4}/;
const CURRENCY_RE = /^[\$€£¥]\s?-?\d/;

export type InferredType = "number" | "date" | "string" | "boolean" | "currency";

export function inferType(values: unknown[]): InferredType {
  let nums = 0,
    dates = 0,
    bools = 0,
    cur = 0,
    nonNull = 0;
  for (const v of values) {
    if (v == null || v === "") continue;
    nonNull += 1;
    if (typeof v === "number") {
      nums += 1;
      continue;
    }
    if (typeof v === "boolean") {
      bools += 1;
      continue;
    }
    const s = String(v).trim();
    if (CURRENCY_RE.test(s)) cur += 1;
    else if (NUMERIC_RE.test(s)) nums += 1;
    else if (DATE_HINT_RE.test(s) && !Number.isNaN(Date.parse(s))) dates += 1;
    else if (/^(true|false|yes|no|y|n|0|1)$/i.test(s)) bools += 1;
  }
  if (nonNull === 0) return "string";
  if (cur / nonNull > 0.6) return "currency";
  if (dates / nonNull > 0.6) return "date";
  if (nums / nonNull > 0.6) return "number";
  if (bools / nonNull > 0.8) return "boolean";
  return "string";
}

function parseLoose(v: unknown, type: InferredType): number | string | null {
  if (v == null || v === "") return null;
  const s = typeof v === "string" ? v.trim() : String(v);
  if (type === "number") {
    const n = Number(s.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (type === "currency") {
    const n = Number(s.replace(/[^\d.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (type === "date") {
    const t = Date.parse(s);
    return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Individual rules — each returns 0 or more findings.
// ---------------------------------------------------------------------------

function ruleMissingValues(table: string, rows: Row[], cfg: DataQualityConfig): DqFinding[] {
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  const out: DqFinding[] = [];
  for (const col of cols) {
    let nulls = 0;
    for (const r of rows) {
      const v = r[col];
      if (v == null || v === "") nulls += 1;
    }
    const rate = nulls / rows.length;
    if (rate > cfg.nullRateThreshold) {
      out.push({
        id: `${table}::missing::${col}`,
        rule: "missing-values",
        severity: rate > 0.3 ? "critical" : "warn",
        title: `${nulls.toLocaleString()} missing values in \`${col}\``,
        rationale: `${(rate * 100).toFixed(1)}% of rows in \`${table}.${col}\` are blank — above the ${(cfg.nullRateThreshold * 100).toFixed(0)}% threshold.`,
        applyLabel: rate > 0.5 ? "Drop column" : "Fill with median / mode",
        scope: { table, columns: [col] },
        evidence: { count: nulls, total: rows.length },
      });
    }
  }
  return out;
}

function ruleTypeCoercion(table: string, rows: Row[], cfg: DataQualityConfig): DqFinding[] {
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  const out: DqFinding[] = [];
  for (const col of cols) {
    const values = rows.map((r) => r[col]);
    const inferred = inferType(values);
    if (inferred === "string") continue;
    let bad = 0;
    const samples: unknown[] = [];
    for (const v of values) {
      if (v == null || v === "") continue;
      if (parseLoose(v, inferred) == null) {
        bad += 1;
        if (samples.length < 3) samples.push(v);
      }
    }
    const denom = values.filter((v) => v != null && v !== "").length || 1;
    const rate = bad / denom;
    if (bad > 0 && rate <= 0.5 && rate > cfg.coerceRateThreshold) {
      out.push({
        id: `${table}::coerce::${col}`,
        rule: "type-coercion",
        severity: "warn",
        title: `${bad.toLocaleString()} malformed ${inferred} value${bad === 1 ? "" : "s"} in \`${col}\``,
        rationale: `\`${col}\` looks like a ${inferred} column but ${(rate * 100).toFixed(1)}% of values don't parse cleanly (e.g. ${samples.map((s) => JSON.stringify(s)).join(", ")}).`,
        applyLabel: `Coerce \`${col}\` → ${inferred}`,
        scope: { table, columns: [col] },
        evidence: { count: bad, total: denom, sample: samples },
      });
    }
  }
  return out;
}

function ruleDuplicates(table: string, rows: Row[], cfg: DataQualityConfig): DqFinding[] {
  if (rows.length < 2) return [];
  const seen = new Map<string, number>();
  for (const r of rows) {
    const key = JSON.stringify(r);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  let dupes = 0;
  for (const c of seen.values()) if (c > 1) dupes += c - 1;
  const rate = dupes / rows.length;
  if (rate > cfg.dedupeRateThreshold) {
    return [
      {
        id: `${table}::dupes`,
        rule: "duplicate-rows",
        severity: rate > 0.05 ? "critical" : "warn",
        title: `${dupes.toLocaleString()} duplicate row${dupes === 1 ? "" : "s"}`,
        rationale: `${(rate * 100).toFixed(2)}% of rows in \`${table}\` are exact duplicates — Databricks/Tableau best practice is to drop them before analysis.`,
        applyLabel: `Drop ${dupes.toLocaleString()} duplicate row${dupes === 1 ? "" : "s"}`,
        scope: { table },
        evidence: { count: dupes, total: rows.length },
      },
    ];
  }
  return [];
}

function ruleOutliers(table: string, rows: Row[], cfg: DataQualityConfig): DqFinding[] {
  if (rows.length < 30) return [];
  const cols = Object.keys(rows[0] ?? {});
  const out: DqFinding[] = [];
  for (const col of cols) {
    const nums: number[] = [];
    for (const r of rows) {
      const v = r[col];
      if (typeof v === "number" && Number.isFinite(v)) nums.push(v);
      else if (typeof v === "string" && NUMERIC_RE.test(v.trim())) {
        const n = Number(v.replace(/,/g, ""));
        if (Number.isFinite(n)) nums.push(n);
      }
    }
    if (nums.length < 30) continue;
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
    const sd = Math.sqrt(variance);
    if (sd === 0) continue;
    const outliers = nums.filter((n) => Math.abs((n - mean) / sd) > cfg.outlierZScore);
    if (outliers.length > 0) {
      const sample = outliers.slice(0, 3);
      const rate = outliers.length / nums.length;
      out.push({
        id: `${table}::outliers::${col}`,
        rule: "outliers",
        severity: rate > 0.05 ? "critical" : "info",
        title: `${outliers.length.toLocaleString()} outlier${outliers.length === 1 ? "" : "s"} in \`${col}\``,
        rationale: `Values beyond ${cfg.outlierZScore}σ from the mean (${mean.toFixed(2)} ± ${sd.toFixed(2)}) — e.g. ${sample.map((n) => n.toLocaleString()).join(", ")}.`,
        applyLabel: `Winsorize \`${col}\` at ${cfg.outlierZScore}σ`,
        scope: { table, columns: [col] },
        evidence: { count: outliers.length, total: nums.length, sample },
      });
    }
  }
  return out;
}

/**
 * Cross-table rule: spot likely joins by name/type/value-overlap. Mirrors
 * Tableau's "suggested relationship" UX. Runs only when ≥ 2 tables exist.
 */
function ruleJoinCandidates(tables: { name: string; rows: Row[] }[]): DqFinding[] {
  const out: DqFinding[] = [];
  if (tables.length < 2) return out;

  // Build a per-table column → unique-value-set index. Caps at 5K values
  // per column to keep the n^2 walk cheap.
  const indexes = tables.map((t) => {
    const cols = t.rows[0] ? Object.keys(t.rows[0]) : [];
    const map = new Map<string, Set<string>>();
    for (const col of cols) {
      const set = new Set<string>();
      for (const r of t.rows) {
        const v = r[col];
        if (v == null || v === "") continue;
        set.add(String(v));
        if (set.size >= 5000) break;
      }
      map.set(col, set);
    }
    return { name: t.name, rowCount: t.rows.length, cols: map };
  });

  for (let i = 0; i < indexes.length; i += 1) {
    for (let j = i + 1; j < indexes.length; j += 1) {
      const a = indexes[i];
      const b = indexes[j];
      for (const [colA, setA] of a.cols) {
        for (const [colB, setB] of b.cols) {
          // Heuristic: name match (id ~ id, customer_id ~ customer.id) OR
          // very high value-overlap on a high-cardinality column.
          const nameMatch =
            colA.toLowerCase() === colB.toLowerCase() ||
            colA.toLowerCase().endsWith(`_${colB.toLowerCase()}`) ||
            colB.toLowerCase().endsWith(`_${colA.toLowerCase()}`);
          if (!nameMatch) continue;
          if (setA.size < 5 || setB.size < 5) continue;

          const small = setA.size < setB.size ? setA : setB;
          const big = small === setA ? setB : setA;
          let overlap = 0;
          for (const v of small) if (big.has(v)) overlap += 1;
          const rate = overlap / small.size;
          if (rate < 0.5) continue;

          out.push({
            id: `join::${a.name}.${colA}::${b.name}.${colB}`,
            rule: "join-candidate",
            severity: "info",
            title: `\`${a.name}.${colA}\` matches \`${b.name}.${colB}\``,
            rationale: `${(rate * 100).toFixed(0)}% of values in \`${a.name}.${colA}\` (${small.size.toLocaleString()} unique) appear in \`${b.name}.${colB}\` — looks like a foreign-key relationship.`,
            applyLabel: `Join on ${colA} = ${colB}`,
            scope: { table: a.name, columns: [colA], otherTable: b.name },
            evidence: { count: overlap, total: small.size },
          });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export interface DqInput {
  /** Logical table name shown to the user. */
  name: string;
  rows: Row[];
}

/**
 * Run every rule across one or more tables and return findings sorted by
 * severity (critical → warn → info). Safe to call on any input — empty
 * arrays just return `[]`.
 */
export function profile(
  tables: DqInput[],
  config: Partial<DataQualityConfig> = {},
): DqFinding[] {
  const cfg = { ...DEFAULT_DQ_CONFIG, ...config };
  const findings: DqFinding[] = [];
  for (const t of tables) {
    if (!t.rows.length) continue;
    findings.push(...ruleMissingValues(t.name, t.rows, cfg));
    findings.push(...ruleTypeCoercion(t.name, t.rows, cfg));
    findings.push(...ruleDuplicates(t.name, t.rows, cfg));
    findings.push(...ruleOutliers(t.name, t.rows, cfg));
  }
  findings.push(...ruleJoinCandidates(tables));

  const order: Record<DqSeverity, number> = { critical: 0, warn: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return findings;
}
