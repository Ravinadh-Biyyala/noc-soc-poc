import { CHART_RULES, RESPONSE_RULES, SQL_SAFETY_RULES } from "../shared/blocks";
import { getProjectSchemaName } from "@workspace/db";

interface ProjectContext {
  projectId: number;
  projectName: string;
  projectDescription: string | null;
  warehouseTables: Array<{ tableName: string; columns: Array<{ name: string; type: string }>; rowCount: number }>;
  relationships: Array<{ sourceTable: string; sourceColumn: string; targetTable: string; targetColumn: string }>;
}

/**
 * Phase 3 — Analyst Chat.
 *
 * Persona: a BI analyst answering ad-hoc questions over a finished warehouse.
 * Read-only: only execute_warehouse_query is available. Cannot create
 * transformations, dashboards, or relationships — those are owned by the
 * Phase 1 and Phase 2 agents.
 *
 * Includes CHART_RULES + RESPONSE_RULES; excludes TRANSFORM_SQL_RULES.
 */
export function buildAnalystChatPrompt(ctx: ProjectContext): string {
  const warehouseSchema = getProjectSchemaName(ctx.projectId, "warehouse");

  const tablesSummary = ctx.warehouseTables.length === 0
    ? "(warehouse is empty — answer that the user must finish Phase 1 first)"
    : ctx.warehouseTables.map((t) => {
        const cols = t.columns.map((c) => `${c.name} ${c.type}`).join(", ");
        return `- "${warehouseSchema}"."${t.tableName}" (${t.rowCount} rows) — ${cols}`;
      }).join("\n");

  const joinHints = ctx.relationships.length === 0
    ? ""
    : "\nKNOWN JOIN PATHS:\n" + ctx.relationships.map((r) =>
        `- ${r.sourceTable}.${r.sourceColumn} = ${r.targetTable}.${r.targetColumn}`
      ).join("\n");

  return [
    `You are a BI analyst answering questions about one specific project's warehouse data.`,
    ``,
    `PROJECT CONTEXT:`,
    `- Name: ${ctx.projectName}`,
    ctx.projectDescription ? `- Stated goal: ${ctx.projectDescription}` : ``,
    `- Warehouse schema (READ-ONLY): ${warehouseSchema}`,
    ``,
    `AVAILABLE TABLES:`,
    tablesSummary,
    joinHints,
    ``,
    `YOUR JOB:`,
    `1. Read the user's question carefully. Identify which table(s) and columns answer it.`,
    `2. Call execute_warehouse_query with a SELECT that returns just what's needed.`,
    `3. Write a 1–2 sentence insight, then emit the right visual:`,
    `   - METRIC for a single number ("how many", "what's the total", "what's the average")`,
    `   - TABLE for ranked / multi-column lists`,
    `   - CHART for trends, comparisons, distributions`,
    `4. If the SQL errors, fix it once and retry. If the column the user asked about doesn't exist, say so plainly.`,
    ``,
    `WHAT YOU NEVER DO:`,
    `- Never create, modify, or drop anything. You are strictly read-only.`,
    `- Never invent numbers. Every figure in your reply must come from a tool result in this conversation.`,
    `- Never reference tables outside ${warehouseSchema}.`,
    ``,
    SQL_SAFETY_RULES,
    ``,
    CHART_RULES,
    ``,
    RESPONSE_RULES,
  ].join("\n");
}
