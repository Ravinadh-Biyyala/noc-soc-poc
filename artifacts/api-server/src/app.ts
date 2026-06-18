import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import session from "express-session";
import pinoHttp from "pino-http";
import { createProxyMiddleware } from "http-proxy-middleware";
import router from "./routes";
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

// In development allow the Vite dev server; in production lock to the configured origin.
const allowedOrigin = process.env.CORS_ORIGIN ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:5173");
app.use(cors({ origin: allowedOrigin || false, credentials: true }));

// When AGENTS_SERVICE_URL is set, forward the Loki logs vertical (read-only
// label/value/query endpoints) to the Python service. Mounted BEFORE the body
// parsers so the raw request body streams through untouched.
const agentsServiceUrl = process.env.AGENTS_SERVICE_URL;
if (agentsServiceUrl) {
  const LOKI_PATH = /^\/api\/loki(\/|$)/;
  app.use(
    createProxyMiddleware({
      target: agentsServiceUrl,
      changeOrigin: true,
      pathFilter: (path: string) => LOKI_PATH.test(path),
      on: {
        error: (err, _req, res) => {
          logger.error({ err }, "loki proxy error");
          const r = res as unknown as { headersSent?: boolean; writeHead?: Function; end?: Function };
          if (r && r.writeHead && !r.headersSent) {
            r.writeHead(502, { "Content-Type": "application/json" });
            r.end!(JSON.stringify({ error: "Loki service unavailable" }));
          }
        },
      },
    }),
  );
  logger.info({ target: agentsServiceUrl }, "Loki routes proxied to Python service");
}

// CopilotKit runtime (right-rail BI Companion). Mounted BEFORE the body parsers
// so its GraphQL transport receives the raw request body untouched. The GET
// /api/copilotkit/instructions sub-route is a no-body request, so it is safe here too.
app.use(copilotKitRouter);

// Default body limit for everything else
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

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
