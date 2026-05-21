import "express-session";

export interface PgConnConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: "require" | "prefer" | "disable";
}

declare module "express-session" {
  interface SessionData {
    userId: number;
    pgConn: PgConnConfig;
  }
}
