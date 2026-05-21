import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync, existsSync } from "node:fs";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Load the workspace-root .env into process.env so vite.config.ts can read
// API_PROXY_TARGET and other shared vars (same logic as run-dev.mjs).
const rootEnv = path.resolve(import.meta.dirname, "../../.env");
if (existsSync(rootEnv)) {
  for (const line of readFileSync(rootEnv, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

// On Replit the workflow injects PORT + BASE_PATH. For local dev (plain
// `pnpm dev` on a laptop) we fall back to sensible defaults so contributors
// don't have to export env vars by hand.
const rawPort = process.env.VITE_PORT ?? "5173";
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}
const basePath = process.env.BASE_PATH ?? "/";

// In local dev the dashboard and the API server run on different ports.
// We proxy `/api/*` from the Vite dev server to the API so all client
// code can keep using relative URLs (matches the Replit shared-proxy
// behaviour). Override with API_PROXY_TARGET if your API runs elsewhere.
const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:8080";
const pythonProxyTarget = process.env.PYTHON_PROXY_TARGET ?? "http://localhost:8090";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    proxy: {
      "/api/python": {
        target: pythonProxyTarget,
        changeOrigin: true,
      },
      "/python": {
        target: pythonProxyTarget,
        changeOrigin: true,
      },
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      "/auth": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
