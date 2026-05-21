import { pgTable, serial, text, integer, jsonb, timestamp, varchar, uniqueIndex } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const pipelineCheckpoints = pgTable(
  "pipeline_checkpoints",
  {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    threadId: varchar("thread_id", { length: 128 }).notNull(),
    state: jsonb("state").notNull(),
    currentPhase: varchar("current_phase", { length: 64 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    threadIdx: uniqueIndex("pipeline_checkpoints_thread_idx").on(table.workspaceId, table.threadId),
  })
);

export type PipelineCheckpoint = typeof pipelineCheckpoints.$inferSelect;
export type InsertPipelineCheckpoint = typeof pipelineCheckpoints.$inferInsert;
