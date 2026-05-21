/**
 * Pipeline state shared across the 3-agent LangGraph state machine.
 *
 * The shape mirrors the user's spec (TypedDict in Python):
 *   - projectId            current workspace id
 *   - rawSchemaMetadata    output of get_schema_info for the raw tables
 *   - proposedTransformations Data Engineer's proposed cleaning steps
 *   - semanticModel        Data Modeler's accepted graph (facts / dims / joins)
 *   - proposedMetrics      Metric Architect's proposed measures
 *   - userFeedback         optional user instruction passed mid-graph
 *   - currentPhase         drives the conditional edges
 *   - threadId             checkpointer key
 *   - log                  carry pino logger through nodes (NOT persisted)
 */
import { z } from "zod";

export const PHASES = ["bronze_to_silver", "silver_to_semantic", "gold_metrics", "done"] as const;
export type Phase = typeof PHASES[number];

export const ColumnInfoSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean().optional(),
  nullCount: z.number().optional(),
  distinctCount: z.number().optional(),
  min: z.string().nullable().optional(),
  max: z.string().nullable().optional(),
});

export const RawTableMetaSchema = z.object({
  tableName: z.string(),
  rowCount: z.number(),
  columns: z.array(ColumnInfoSchema),
});

export const ProposedTransformationSchema = z.object({
  id: z.number().optional(),
  kind: z.string(),
  title: z.string(),
  sql: z.string(),
  targetTableName: z.string(),
  status: z.string(),
});

export const SemanticJoinSchema = z.object({
  from: z.string(),
  to: z.string(),
  cardinality: z.enum(["1:1", "1:N", "N:1", "N:N"]),
});

export const SemanticModelSchema = z.object({
  facts: z.array(z.string()),
  dimensions: z.array(z.string()),
  joins: z.array(SemanticJoinSchema),
});

export const ProposedMetricSchema = z.object({
  id: z.number().optional(),
  metricName: z.string(),
  description: z.string().optional(),
  sqlFormula: z.string(),
  dependsOnTables: z.array(z.string()),
  status: z.string(),
});

export const PipelineStateSchema = z.object({
  projectId: z.number(),
  threadId: z.string(),
  rawSchemaMetadata: z.array(RawTableMetaSchema).default([]),
  proposedTransformations: z.array(ProposedTransformationSchema).default([]),
  semanticModel: SemanticModelSchema.nullable().default(null),
  proposedMetrics: z.array(ProposedMetricSchema).default([]),
  userFeedback: z.string().optional(),
  currentPhase: z.enum(PHASES),
});

export type PipelineState = z.infer<typeof PipelineStateSchema>;
export type ColumnInfo = z.infer<typeof ColumnInfoSchema>;
export type RawTableMeta = z.infer<typeof RawTableMetaSchema>;
export type SemanticModel = z.infer<typeof SemanticModelSchema>;
export type ProposedTransformation = z.infer<typeof ProposedTransformationSchema>;
export type ProposedMetric = z.infer<typeof ProposedMetricSchema>;

/** Initial state for a fresh pipeline run. */
export function initialState(projectId: number, threadId: string): PipelineState {
  return {
    projectId,
    threadId,
    rawSchemaMetadata: [],
    proposedTransformations: [],
    semanticModel: null,
    proposedMetrics: [],
    currentPhase: "bronze_to_silver",
  };
}
