import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const workspaces = pgTable("workspaces", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  packId: text("pack_id").notNull(),
  description: text("description"),
  ownerName: text("owner_name").notNull().default("You"),
  status: text("status").notNull().default("draft"),
  readinessScore: integer("readiness_score").notNull().default(0),
  fileCount: integer("file_count").notNull().default(0),
  dashboardCount: integer("dashboard_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertWorkspaceSchema = createInsertSchema(workspaces).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  fileCount: true,
  dashboardCount: true,
  readinessScore: true,
  status: true,
  ownerName: true,
});

export type Workspace = typeof workspaces.$inferSelect;
export type InsertWorkspace = z.infer<typeof insertWorkspaceSchema>;
