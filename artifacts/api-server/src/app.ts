import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import session from "express-session";
import pinoHttp from "pino-http";
import { createProxyMiddleware } from "http-proxy-middleware";
import router from "./routes";
import authRouter from "./routes/auth";
import copilotKitRouter from "./routes/copilotkit";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  session({
    secret: process.env.SESSION_SECRET ?? "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { sameSite: "none", secure: true },
  }),
);

// Allow Salesforce to embed this app in an iframe
app.use((_req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors 'self' https://*.lightning.force.com https://*.salesforce.com https://*.force.com",
  );
  next();
});

// In development allow the Vite dev server; in production lock to the configured origin.
const allowedOrigin = process.env.CORS_ORIGIN ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:5173");
app.use(cors({ origin: allowedOrigin || false, credentials: true }));

// Feature-flagged migration proxy: when AGENTS_SERVICE_URL is set, forward the
// AI agent vertical (data-engineer / data-modeler / metric-architect suggest +
// accept/reject, semantic-model, metrics, dashboards, warehouse-tables,
// relationships, analyst-chat SSE, and the orchestrated pipeline) to the Python
// LangGraph service. Mounted BEFORE the body parsers so the raw request body
// (and SSE responses) stream through untouched. Ingest/raw-tables and every
// other route stay on Express. Unset the env var to fall back to the TS routers.
const agentsServiceUrl = process.env.AGENTS_SERVICE_URL;
if (agentsServiceUrl) {
  const AGENT_PATH =
    /^\/api\/projects\/\d+\/(agents|transformations|semantic-model|relationships|metrics|warehouse-tables|dashboards|pipeline)(\/|$)/;
  app.use(
    createProxyMiddleware({
      target: agentsServiceUrl,
      changeOrigin: true,
      pathFilter: (path: string) => AGENT_PATH.test(path),
      on: {
        error: (err, _req, res) => {
          logger.error({ err }, "agent proxy error");
          const r = res as unknown as { headersSent?: boolean; writeHead?: Function; end?: Function };
          if (r && r.writeHead && !r.headersSent) {
            r.writeHead(502, { "Content-Type": "application/json" });
            r.end!(JSON.stringify({ error: "Agent service unavailable" }));
          }
        },
      },
    }),
  );
  logger.info({ target: agentsServiceUrl }, "Agent routes proxied to Python service");
}

// CopilotKit runtime (right-rail BI Companion). Mounted BEFORE the body parsers
// so its GraphQL transport receives the raw request body untouched. The GET
// /api/copilotkit/instructions sub-route is a no-body request, so it is safe here too.
app.use(copilotKitRouter);

// Heavy JSON body only for the dashboard-generation route
app.use("/api/generate-dashboard", express.json({ limit: "25mb" }));
// Default body limit for everything else
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Auth routes at root level (/auth, /auth/callback, /auth/status, /auth/logout)
app.use(authRouter);

app.use("/api", router);

// Global error handler — catches any error thrown or passed via next(err) in route handlers
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const log = (req as any).log ?? logger;
  log.error({ err }, "Unhandled route error");
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default app;
