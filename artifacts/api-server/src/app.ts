import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import session from "express-session";
import pinoHttp from "pino-http";
import router from "./routes";
import authRouter from "./routes/auth";
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
