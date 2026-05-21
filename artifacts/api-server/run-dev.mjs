// Cross-platform dev runner — loads .env and avoids Unix-only `export` in npm scripts
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(__dirname, "../../.env");

// Load .env into process.env (simple key=value parser, skips comments/blanks)
if (existsSync(envFile)) {
  const lines = readFileSync(envFile, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

process.env.NODE_ENV = "development";
process.env.PORT ??= "8080";

const build = spawnSync("node", ["./build.mjs"], {
  stdio: "inherit",
  env: process.env,
});
if (build.status !== 0) process.exit(build.status ?? 1);

const serve = spawnSync(
  "node",
  ["--enable-source-maps", "./dist/index.mjs"],
  { stdio: "inherit", env: process.env },
);
process.exit(serve.status ?? 0);
