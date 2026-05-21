import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const sectionPinnedCharts = pgTable("section_pinned_charts", {
  id: serial("id").primaryKey(),
  sectionRoute: text("section_route").notNull(),
  config: jsonb("config").$type<any>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SectionPinnedChart = typeof sectionPinnedCharts.$inferSelect;
