import { pgTable, serial, text, integer, jsonb, timestamp, varchar } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export type SemanticModelStatus = "proposed" | "applied" | "rejected";
export type JoinCardinality = "1:1" | "1:N" | "N:1" | "N:N";

export interface SemanticJoin {
  from: string;
  to: string;
  cardinality: JoinCardinality;
}

export interface SemanticGraphDefinition {
  facts: string[];
  dimensions: string[];
  joins: SemanticJoin[];
}

export const projectSemanticModels = pgTable("project_semantic_models", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 32 }).notNull().default("proposed"),
  graphDefinition: jsonb("graph_definition").$type<SemanticGraphDefinition>().notNull(),
  agentRationale: text("agent_rationale"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ProjectSemanticModel = typeof projectSemanticModels.$inferSelect;
export type InsertProjectSemanticModel = typeof projectSemanticModels.$inferInsert;
