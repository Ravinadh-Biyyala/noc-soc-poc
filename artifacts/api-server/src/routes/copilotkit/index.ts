// CopilotKit runtime — the transport behind the right-rail "BI Companion".
// Implements the AG-UI protocol (CopilotKit are the protocol authors). Frontend
// actions (navigate, open dashboard, switch tab, create dashboard, pin chart)
// live in the browser via useCopilotAction; this runtime adds the server-side
// data-query tool and forwards everything to OpenAI via OpenAIAdapter.
//
// Mounted in app.ts BEFORE express.json() so the GraphQL transport receives the
// raw request body (same pattern as the agents proxy).

import { Router, type IRouter, type Request, type Response } from "express";
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNodeExpressEndpoint,
} from "@copilotkit/runtime";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  runDatasetQuery,
  loadProjectCopilotContext,
  renderProjectContextBlock,
  describeWarehouse,
} from "../openai/agent-tools.js";
import { buildCopilotInstructions } from "../../config/prompt-builder.js";

// Opt out of CopilotKit's anonymous runtime telemetry by default (matches the
// repo's privacy-conscious posture). Set COPILOTKIT_TELEMETRY_DISABLED=false to re-enable.
process.env.COPILOTKIT_TELEMETRY_DISABLED ??= "true";

const ENDPOINT = "/api/copilotkit";

const serviceAdapter = new OpenAIAdapter({
  // The integrations client is openai v6; the adapter's bundled openai type may
  // differ by a patch — they are runtime-compatible, so cast through unknown.
  openai: openai as unknown as never,
  model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
});

// Server-side actions are built per-request so they can read the workspaceId
// the client passes via <CopilotKit properties={{ workspaceId }}> and scope the
// dataset query to that project's semantic model + metrics.
const runtime = new CopilotRuntime({
  // Heterogeneous server actions (different parameter shapes). CopilotRuntime's
  // generic infers a single tuple from the first action, so cast the factory.
  actions: ((({ properties }: { properties: Record<string, unknown> }) => {
    const workspaceId = Number(properties?.workspaceId) || undefined;
    return [
      {
        name: "execute_dataset_query",
        description:
          "Run a SQL SELECT query on an uploaded dataset and return JSON rows. Use whenever the user asks about their imported/uploaded data. The tableName in the SQL must match the datasetId's table (from the UPLOADED DATASETS context).",
        parameters: [
          { name: "datasetId", type: "number", description: "Numeric dataset ID from the UPLOADED DATASETS context. Must match the table used in the SQL.", required: true },
          { name: "sql", type: "string", description: "A valid SELECT query using the exact pg column names and quoted table name from the SAME dataset entry. Add LIMIT to bound results.", required: true },
        ],
        handler: async ({ datasetId, sql }: { datasetId: number; sql: string }) => {
          const projectCtx = workspaceId ? await loadProjectCopilotContext(workspaceId) : null;
          return runDatasetQuery(Number(datasetId), String(sql), projectCtx);
        },
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as unknown) as any,
});

const router: IRouter = Router();

// Per-page instructions (persona + data/dataset context + dashboards + actions
// rules), with the project's semantic-model/metrics appended when a workspaceId
// is supplied. The client fetches this and passes it to <CopilotChat instructions=…>.
router.get("/api/copilotkit/instructions", async (req: Request, res: Response) => {
  try {
    const workspaceId = Number(req.query.workspaceId);
    const hasProject = Number.isFinite(workspaceId) && workspaceId > 0;
    const [base, projectBlock, warehouseBlock] = await Promise.all([
      buildCopilotInstructions(),
      hasProject ? loadProjectCopilotContext(workspaceId).then(renderProjectContextBlock) : Promise.resolve(""),
      hasProject ? describeWarehouse(workspaceId) : Promise.resolve(""),
    ]);
    const instructions = [base, projectBlock, warehouseBlock].filter(Boolean).join("\n\n");
    res.json({ instructions });
  } catch (err) {
    (req as unknown as { log?: { error: Function } }).log?.error({ err }, "copilotkit instructions failed");
    res.json({ instructions: "" });
  }
});

// Runtime endpoint. The handler's internal router matches the FULL path
// (basePath = endpoint) and serves several sub-routes (e.g. /threads), so mount
// it as routes (router.all) — NOT middleware (router.use), which strips the
// prefix and breaks the match. Forward both the base path and any sub-path.
const copilotHandler = copilotRuntimeNodeExpressEndpoint({ endpoint: ENDPOINT, runtime, serviceAdapter });
const forward = (req: Request, res: Response) => copilotHandler(req, res) as Promise<void>;
router.all(ENDPOINT, forward);
router.all(`${ENDPOINT}/*rest`, forward);

export default router;
