import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const copilotDashboards = pgTable("copilot_dashboards", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  route: text("route").notNull().unique(),
  config: jsonb("config").$type<any>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CopilotDashboard = typeof copilotDashboards.$inferSelect;
