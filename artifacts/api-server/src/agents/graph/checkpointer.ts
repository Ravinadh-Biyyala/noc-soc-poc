/**
 * Drizzle-backed persistence for pipeline state.
 *
 * LangGraph's MemorySaver loses state on restart. For long-running multi-step
 * agent pipelines (where the user accepts proposals between phases), state
 * needs to survive restarts. This module persists the StateGraph snapshot
 * after every node completes and loads it back on resume.
 *
 * One row per (workspaceId, threadId) — upsert on writes, lookup on resume.
 */
import { db, pipelineCheckpoints } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { PipelineStateSchema, type PipelineState } from "./state";

export async function saveCheckpoint(state: PipelineState): Promise<void> {
  const existing = await db
    .select()
    .from(pipelineCheckpoints)
    .where(and(
      eq(pipelineCheckpoints.workspaceId, state.projectId),
      eq(pipelineCheckpoints.threadId, state.threadId),
    ))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(pipelineCheckpoints)
      .set({
        state: state as unknown as Record<string, unknown>,
        currentPhase: state.currentPhase,
        updatedAt: new Date(),
      })
      .where(eq(pipelineCheckpoints.id, existing[0].id));
  } else {
    await db.insert(pipelineCheckpoints).values({
      workspaceId: state.projectId,
      threadId: state.threadId,
      state: state as unknown as Record<string, unknown>,
      currentPhase: state.currentPhase,
    });
  }
}

export async function loadCheckpoint(workspaceId: number, threadId: string): Promise<PipelineState | null> {
  const [row] = await db
    .select()
    .from(pipelineCheckpoints)
    .where(and(
      eq(pipelineCheckpoints.workspaceId, workspaceId),
      eq(pipelineCheckpoints.threadId, threadId),
    ))
    .limit(1);

  if (!row) return null;

  const parsed = PipelineStateSchema.safeParse(row.state);
  if (!parsed.success) {
    // Stored checkpoint is shape-incompatible with current code (e.g. schema
    // evolved). Drop it so the caller can start fresh rather than blowing up.
    await db.delete(pipelineCheckpoints).where(eq(pipelineCheckpoints.id, row.id));
    return null;
  }
  return parsed.data;
}

export async function deleteCheckpoint(workspaceId: number, threadId: string): Promise<void> {
  await db
    .delete(pipelineCheckpoints)
    .where(and(
      eq(pipelineCheckpoints.workspaceId, workspaceId),
      eq(pipelineCheckpoints.threadId, threadId),
    ));
}
