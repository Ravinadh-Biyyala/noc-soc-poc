/**
 * 3-agent LangGraph state machine.
 *
 *   bronze_to_silver  → Data Engineer node
 *                          (introspects raw, profiles, proposes cleaning)
 *   silver_to_semantic → Data Modeler node
 *                          (writes semantic graph; no DDL)
 *   gold_metrics       → Metric Architect node
 *                          (writes SQL formulas; no physical columns)
 *
 * Each node is "human-in-the-loop": it produces proposals and returns to the
 * caller. The caller (the API route) hands the user the proposals via the UI
 * and re-enters the graph at the next phase after the user accepts. We do not
 * use LangGraph's native interrupt() because Express handlers are short-lived
 * — we persist via the Drizzle checkpointer and resume by name.
 */
import { StateGraph, END } from "@langchain/langgraph";
import { Annotation } from "@langchain/langgraph";
import type pino from "pino";
import {
  listRawTables,
  listWarehouseTables,
  rawSchema,
  warehouseSchema,
  db,
  projectTransformations,
  projectSemanticModels,
  projectMetrics,
} from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";

import {
  initialState,
  type PipelineState,
  type RawTableMeta,
} from "./state";
import { saveCheckpoint } from "./checkpointer";
import { profileData, proposeTransformation } from "../data-engineer/executor";

// ---------------------------------------------------------------------------
// LangGraph Annotation for our state. Each field has a reducer — the default
// "last value wins" suffices for our snapshot-style updates.
// ---------------------------------------------------------------------------

const StateAnnotation = Annotation.Root({
  projectId: Annotation<number>(),
  threadId: Annotation<string>(),
  rawSchemaMetadata: Annotation<PipelineState["rawSchemaMetadata"]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  proposedTransformations: Annotation<PipelineState["proposedTransformations"]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  semanticModel: Annotation<PipelineState["semanticModel"]>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  proposedMetrics: Annotation<PipelineState["proposedMetrics"]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  userFeedback: Annotation<string | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  currentPhase: Annotation<PipelineState["currentPhase"]>(),
});

// ---------------------------------------------------------------------------
// Node 1 — Data Engineer (Bronze → Silver)
// ---------------------------------------------------------------------------

export async function dataEngineerNode(state: PipelineState, log: pino.Logger): Promise<Partial<PipelineState>> {
  log.info({ projectId: state.projectId, phase: "bronze_to_silver" }, "data-engineer node");

  const tables = await listRawTables(state.projectId);
  if (tables.length === 0) {
    return {
      rawSchemaMetadata: [],
      proposedTransformations: [],
      currentPhase: "bronze_to_silver",
    };
  }

  // Profile each raw table — this is the work the LLM would otherwise call as
  // tools. Keeping the heavy work in TS lets the LLM focus on proposal text.
  const profiled: RawTableMeta[] = [];
  for (const t of tables.slice(0, 12)) {
    const result = await profileData(state.projectId, t.tableName);
    if ("error" in result) continue;
    profiled.push({
      tableName: result.tableName,
      rowCount: result.rowCount,
      columns: result.columns.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        nullCount: c.nullCount,
        distinctCount: c.distinctCount,
        min: c.min ?? null,
        max: c.max ?? null,
      })),
    });
  }

  // Load any already-proposed transformations (the LLM-driven path writes
  // these via tools; this node summarises whatever's in flight).
  const proposed = await db
    .select()
    .from(projectTransformations)
    .where(and(
      eq(projectTransformations.projectId, state.projectId),
      eq(projectTransformations.status, "proposed"),
    ))
    .orderBy(desc(projectTransformations.createdAt))
    .limit(20);

  return {
    rawSchemaMetadata: profiled,
    proposedTransformations: proposed.map((p) => ({
      id: p.id,
      kind: p.kind,
      title: p.title,
      sql: p.sql,
      targetTableName: p.targetTableName,
      status: p.status,
    })),
    currentPhase: "bronze_to_silver",
  };
}

// ---------------------------------------------------------------------------
// Node 2 — Data Modeler (Silver → Semantic)
// ---------------------------------------------------------------------------

export async function dataModelerNode(state: PipelineState, log: pino.Logger): Promise<Partial<PipelineState>> {
  log.info({ projectId: state.projectId, phase: "silver_to_semantic" }, "data-modeler node");

  const [latest] = await db
    .select()
    .from(projectSemanticModels)
    .where(and(
      eq(projectSemanticModels.workspaceId, state.projectId),
      eq(projectSemanticModels.status, "applied"),
    ))
    .orderBy(desc(projectSemanticModels.createdAt))
    .limit(1);

  return {
    semanticModel: latest?.graphDefinition ?? null,
    currentPhase: "silver_to_semantic",
  };
}

// ---------------------------------------------------------------------------
// Node 3 — Metric Architect (Gold layer)
// ---------------------------------------------------------------------------

export async function metricArchitectNode(state: PipelineState, log: pino.Logger): Promise<Partial<PipelineState>> {
  log.info({ projectId: state.projectId, phase: "gold_metrics" }, "metric-architect node");

  const proposed = await db
    .select()
    .from(projectMetrics)
    .where(and(
      eq(projectMetrics.workspaceId, state.projectId),
      eq(projectMetrics.status, "proposed"),
    ))
    .orderBy(desc(projectMetrics.createdAt))
    .limit(50);

  return {
    proposedMetrics: proposed.map((m) => ({
      id: m.id,
      metricName: m.metricName,
      description: m.description ?? undefined,
      sqlFormula: m.sqlFormula,
      dependsOnTables: m.dependsOnTables,
      status: m.status,
    })),
    currentPhase: "gold_metrics",
  };
}

// ---------------------------------------------------------------------------
// Build the StateGraph.
//
// Edges are deterministic per phase. The router function reads currentPhase
// and decides which node runs next. Each node returns the SAME phase if it
// expects user feedback before advancing — callers persist the checkpoint and
// re-enter the graph after the user clicks Accept on a proposal.
// ---------------------------------------------------------------------------

function routeByPhase(state: PipelineState): "data_engineer" | "data_modeler" | "metric_architect" | typeof END {
  switch (state.currentPhase) {
    case "bronze_to_silver":  return "data_engineer";
    case "silver_to_semantic": return "data_modeler";
    case "gold_metrics":       return "metric_architect";
    case "done":               return END;
    default:                   return END;
  }
}

export function buildPipelineGraph(log: pino.Logger) {
  const graph = new StateGraph(StateAnnotation)
    .addNode("data_engineer", async (s) => {
      const update = await dataEngineerNode(s as PipelineState, log);
      await saveCheckpoint({ ...(s as PipelineState), ...update } as PipelineState);
      return update;
    })
    .addNode("data_modeler", async (s) => {
      const update = await dataModelerNode(s as PipelineState, log);
      await saveCheckpoint({ ...(s as PipelineState), ...update } as PipelineState);
      return update;
    })
    .addNode("metric_architect", async (s) => {
      const update = await metricArchitectNode(s as PipelineState, log);
      await saveCheckpoint({ ...(s as PipelineState), ...update } as PipelineState);
      return update;
    })
    .addConditionalEdges("__start__" as never, routeByPhase as never, {
      data_engineer: "data_engineer",
      data_modeler: "data_modeler",
      metric_architect: "metric_architect",
      [END]: END,
    })
    .addEdge("data_engineer", END)
    .addEdge("data_modeler", END)
    .addEdge("metric_architect", END);

  return graph.compile();
}

/** Convenience: build a one-shot run starting at the given phase. */
export async function runPipelinePhase(
  projectId: number,
  threadId: string,
  phase: PipelineState["currentPhase"],
  log: pino.Logger,
): Promise<PipelineState> {
  const compiled = buildPipelineGraph(log);
  const start = initialState(projectId, threadId);
  start.currentPhase = phase;
  const result = await compiled.invoke(start);
  return result as PipelineState;
}

export { rawSchema, warehouseSchema, listWarehouseTables };
