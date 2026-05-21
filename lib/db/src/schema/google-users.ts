import { pgTable, serial, text, bigint, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").unique().notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiry: bigint("token_expiry", { mode: "number" }),
  createdAt: timestamp("created_at").defaultNow(),
});
