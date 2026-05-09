import type { Table, FilterOperation } from "./data-operations";

export type QualityIssueKind = "high_nulls" | "negative_in_positive";

export interface QualityIssue {
  id: string;
  kind: QualityIssueKind;
  tableId: string;
  tableName: string;
  column: string;
  severity: "info" | "warn" | "high";
  // Short headline shown on the chip row.
  headline: string;
  // Plain-English explanation surfaced in the "why" tooltip.
  why: string;
  // One-click fixes the user can apply or ignore. The first non-ignore
  // fix is the recommended default action.
  fixes: QualityFix[];
}

export type QualityFix =
  | { kind: "drop_nulls"; label: string }
  | { kind: "filter_nonneg"; label: string }
  | { kind: "ignore"; label: string };

const POSITIVE_COL_RE =
  /(price|amount|total|qty|quantity|count|revenue|premium|spend|cost|sales|gross|net|fee|paid|due|balance|rate)/i;

function nullCount(rows: Record<string, unknown>[], col: string): number {
  let n = 0;
  for (const r of rows) {
    const v = r[col];
    if (v === null || v === undefined || v === "") n++;
  }
  return n;
}

function negativeCount(
  rows: Record<string, unknown>[],
  col: string,
): { neg: number; numeric: number } {
  let neg = 0;
  let numeric = 0;
  for (const r of rows) {
    const v = r[col];
    if (v === null || v === undefined || v === "") continue;
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) {
      numeric++;
      if (n < 0) neg++;
    }
  }
  return { neg, numeric };
}

/**
 * Heuristic quality checks the Copilot can surface as one-click chips.
 * Intentionally conservative — only flag issues we can actually fix with
 * the existing operation set so the chips are honest.
 */
export function detectQualityIssues(tables: Table[]): QualityIssue[] {
  const out: QualityIssue[] = [];

  for (const table of tables) {
    if (table.rows.length === 0) continue;
    const total = table.rows.length;

    for (const col of table.columns) {
      const nulls = nullCount(table.rows, col.name);
      const nullPct = nulls / total;

      if (nullPct >= 0.2) {
        out.push({
          id: `q-${table.id}-${col.name}-nulls`,
          kind: "high_nulls",
          tableId: table.id,
          tableName: table.name,
          column: col.name,
          severity: nullPct >= 0.5 ? "high" : "warn",
          headline: `${Math.round(nullPct * 100)}% of ${col.name} is empty`,
          why: `${nulls.toLocaleString()} of ${total.toLocaleString()} rows in ${table.name}.${col.name} are missing. This usually distorts averages and breaks groupings.`,
          fixes: [
            { kind: "drop_nulls", label: "Drop rows" },
            { kind: "ignore", label: "Ignore" },
          ],
        });
      }

      if (col.type === "number" || col.type === "string") {
        if (POSITIVE_COL_RE.test(col.name)) {
          const { neg, numeric } = negativeCount(table.rows, col.name);
          if (numeric > 0 && neg / numeric >= 0.02) {
            out.push({
              id: `q-${table.id}-${col.name}-neg`,
              kind: "negative_in_positive",
              tableId: table.id,
              tableName: table.name,
              column: col.name,
              severity: "warn",
              headline: `${neg} negative values in ${col.name}`,
              why: `${col.name} looks like it should always be positive (e.g. price, amount, premium). ${neg} of ${numeric.toLocaleString()} rows are negative — usually refunds, reversals, or data-entry errors.`,
              fixes: [
                { kind: "filter_nonneg", label: "Filter to ≥ 0" },
                { kind: "ignore", label: "Ignore" },
              ],
            });
          }
        }
      }
    }
  }

  // Cap to keep the panel scannable. Highest severity first, then by
  // affected-row count baked into the headline ordering.
  const sevRank = { high: 0, warn: 1, info: 2 } as const;
  out.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
  return out.slice(0, 4);
}

/**
 * Translate a fix decision into a concrete pipeline operation that the
 * existing executePipeline understands. Returns null for "ignore" — the
 * caller should still log the decision to the audit trail.
 */
export function buildFixOperation(
  issue: QualityIssue,
  fix: QualityFix,
): FilterOperation | null {
  const id = `op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  if (fix.kind === "drop_nulls") {
    return {
      id,
      type: "filter",
      inputTableId: issue.tableId,
      column: issue.column,
      op: "is_not_null",
      value: "",
      outputName: `${issue.tableName}_no_null_${issue.column}`,
    };
  }
  if (fix.kind === "filter_nonneg") {
    return {
      id,
      type: "filter",
      inputTableId: issue.tableId,
      column: issue.column,
      op: "greater_equal",
      value: 0,
      outputName: `${issue.tableName}_${issue.column}_nonneg`,
    };
  }
  return null;
}

// ============================================================================
// Audit trail — per-workspace decision log persisted to localStorage so it
// survives a page refresh during the demo. In a real deployment this would
// be backed by /api/audit/:workspaceId on the server.
// ============================================================================

export type AuditCategory =
  | "join_apply"
  | "join_customize"
  | "join_dismiss"
  | "quality_fix"
  | "quality_ignore";

export interface AuditEntry {
  id: string;
  ts: number;
  category: AuditCategory;
  // One-line plain-English description for the decisions log.
  summary: string;
  // Rich payload (operation, issue, etc.) for downstream lineage views.
  payload?: Record<string, unknown>;
}

const STORAGE_KEY_PREFIX = "gen-bi:audit:";
const DEFAULT_BUCKET = "default";
const MAX_ENTRIES = 100;

function bucketKey(workspaceId?: string | null): string {
  return STORAGE_KEY_PREFIX + (workspaceId || DEFAULT_BUCKET);
}

function readAll(workspaceId?: string | null): AuditEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(bucketKey(workspaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AuditEntry[]) : [];
  } catch {
    return [];
  }
}

function writeAll(workspaceId: string | null | undefined, entries: AuditEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      bucketKey(workspaceId),
      JSON.stringify(entries.slice(-MAX_ENTRIES)),
    );
  } catch {
    // Quota exceeded or storage disabled — silently drop. Audit is
    // demo-grade and not on the critical path.
  }
}

export function logDecision(
  category: AuditCategory,
  summary: string,
  payload?: Record<string, unknown>,
  workspaceId?: string | null,
): AuditEntry {
  const entry: AuditEntry = {
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    category,
    summary,
    payload,
  };
  const all = readAll(workspaceId);
  all.push(entry);
  writeAll(workspaceId, all);
  // Notify listeners (e.g. a Decisions panel) so they can refresh without
  // polling. Custom event keeps the contract loose.
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("gen-bi:audit", { detail: { workspaceId: workspaceId || DEFAULT_BUCKET, entry } }),
    );
  }
  return entry;
}

export function getDecisions(workspaceId?: string | null): AuditEntry[] {
  return readAll(workspaceId);
}

export function clearDecisions(workspaceId?: string | null): void {
  writeAll(workspaceId, []);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("gen-bi:audit", { detail: { workspaceId: workspaceId || DEFAULT_BUCKET, cleared: true } }),
    );
  }
}
