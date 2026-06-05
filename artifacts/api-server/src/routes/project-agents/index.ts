/**
 * Project-scoped agent endpoints.
 *
 * Three agents, three URL prefixes:
 *   /api/projects/:id/agents/data-engineer/*
 *   /api/projects/:id/agents/data-modeler/*
 *   /api/projects/:id/agents/analyst-chat/*
 *
 * Each agent's system prompt is composed from situation-specific blocks (see
 * src/agents/{name}/system-prompt.ts). The full streaming + tool-execution
 * loop is shared via the runner in src/agents/shared/runner.ts (deferred —
 * see plan). This router currently exposes only the lightweight introspection
 * endpoint /preview-prompt so the prompts can be inspected without an OpenAI
 * call, plus reserves the URL space for the three /suggest|/generate|/messages
 * endpoints that the runner will fill in.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, workspaces as workspacesTable, userDashboards, dashboardCharts, getProjectSchemaName, listWarehouseTables } from "@workspace/db";
import { eq, max } from "drizzle-orm";
import { buildDataEngineerPrompt } from "../../agents/data-engineer/system-prompt";
import { buildDataModelerPrompt } from "../../agents/data-modeler/system-prompt";
import { buildAnalystChatPrompt } from "../../agents/analyst-chat/system-prompt";
import { DATA_ENGINEER_OPENAI_TOOLS } from "../../agents/data-engineer/tools";
import { DATA_MODELER_OPENAI_TOOLS } from "../../agents/data-modeler/tools";
import { ANALYST_CHAT_OPENAI_TOOLS } from "../../agents/analyst-chat/tools";
import { runWarehouseQuery, describeWarehouse } from "../openai/agent-tools.js";

const router: IRouter = Router();

type AgentName = "data-engineer" | "data-modeler" | "analyst-chat";

function parseId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function loadProject(id: number) {
  const [row] = await db
    .select()
    .from(workspacesTable)
    .where(eq(workspacesTable.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * GET /api/projects/:id/agents/:agent/preview-prompt
 *
 * Returns the rendered system prompt + tool descriptors for a given agent.
 * Used by the UI to display "what the agent sees" and by tests to verify
 * the prompt stays focused per phase. No OpenAI call.
 */
router.get("/projects/:id/agents/:agent/preview-prompt", async (req: Request, res: Response) => {
  const id = parseId(req.params.id as string);
  if (id === null) { res.status(400).json({ error: "Invalid project ID" }); return; }

  const agent = req.params.agent as AgentName;
  if (!["data-engineer", "data-modeler", "analyst-chat"].includes(agent)) {
    res.status(400).json({ error: "Unknown agent" });
    return;
  }

  const project = await loadProject(id);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const warehouseSchema = getProjectSchemaName(id, "warehouse");
  let warehouseTables: Array<{ tableName: string; columns: Array<{ name: string; type: string }>; rowCount: number }> = [];
  try {
    const raw = await listWarehouseTables(id);
    warehouseTables = raw.map((t) => ({ tableName: t.tableName, columns: [], rowCount: t.rowCount }));
  } catch {
    // schema may not exist for legacy workspaces; that's fine for the preview
  }

  let systemPrompt: string;
  let tools: unknown;

  if (agent === "data-engineer") {
    systemPrompt = buildDataEngineerPrompt({
      projectId: id,
      projectName: project.name,
      projectDescription: project.description ?? null,
      rawTables: [],
    });
    tools = DATA_ENGINEER_OPENAI_TOOLS;
  } else if (agent === "data-modeler") {
    systemPrompt = buildDataModelerPrompt({
      projectId: id,
      projectName: project.name,
      projectDescription: project.description ?? null,
      warehouseTables,
      existingGraph: null,
    });
    tools = DATA_MODELER_OPENAI_TOOLS;
  } else {
    systemPrompt = buildAnalystChatPrompt({
      projectId: id,
      projectName: project.name,
      projectDescription: project.description ?? null,
      warehouseTables,
      relationships: [],
    });
    tools = ANALYST_CHAT_OPENAI_TOOLS;
  }

  res.json({
    agent,
    projectId: id,
    warehouseSchema,
    systemPrompt,
    promptLineCount: systemPrompt.split("\n").length,
    tools,
  });
});

/**
 * POST /api/projects/:id/dashboards/:dashId/charts
 *
 * Pin a chat-generated visual (chart / table / metric) to an existing project
 * dashboard. The body carries the already-parsed config so no second AI call
 * is needed.
 *
 * Body: { title: string, chartType: string, config: ChartConfig }
 */
router.post("/projects/:id/dashboards/:dashId/charts", async (req: Request, res: Response) => {
  const id = parseId(req.params.id as string);
  const dashId = parseId(req.params.dashId as string);
  if (id === null || dashId === null) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { title, chartType, config } = (req.body ?? {}) as {
    title?: string;
    chartType?: string;
    config?: Record<string, unknown>;
  };
  if (!title || !chartType || !config) {
    res.status(400).json({ error: "title, chartType, and config are required" });
    return;
  }

  try {
    // Verify the dashboard belongs to this project (flat_table_name encodes project id).
    const [dash] = await db
      .select({ id: userDashboards.id, flatTableName: userDashboards.flatTableName })
      .from(userDashboards)
      .where(eq(userDashboards.id, dashId))
      .limit(1);
    if (!dash || !dash.flatTableName.startsWith(`proj_${id}_dash_`)) {
      res.status(404).json({ error: "Dashboard not found for this project" });
      return;
    }

    // Next position = current max + 1 (0 if empty).
    const [{ maxPos }] = await db
      .select({ maxPos: max(dashboardCharts.position) })
      .from(dashboardCharts)
      .where(eq(dashboardCharts.dashboardId, dashId));
    const position = (maxPos ?? -1) + 1;

    const [chart] = await db
      .insert(dashboardCharts)
      .values({ dashboardId: dashId, title, chartType, config: config as any, position })
      .returning();

    res.status(201).json(chart);
  } catch (err) {
    req.log?.error({ err }, "Failed to add chart to dashboard");
    res.status(500).json({ error: "Failed to add chart" });
  }
});

/**
 * POST /api/projects/:id/warehouse-query
 *
 * Runs a read-only SELECT against the project's curated warehouse schema and
 * returns JSON rows. Backs the Copilot's `query_project_warehouse` frontend
 * action so the BI Companion can act as a data analyst over the project data.
 * Not matched by the agents proxy regex, so it's served here by Express.
 *
 * Body: { sql: string }
 */
/**
 * GET /api/projects/:id/warehouse-schema
 *
 * Returns a text description of the project's warehouse tables/views + columns.
 * Backs the Copilot's `list_warehouse_tables` action so it can discover the
 * exact schema before writing SQL (never guess table names).
 */
router.get("/projects/:id/warehouse-schema", async (req: Request, res: Response) => {
  const id = parseId(req.params.id as string);
  if (id === null) { res.status(400).json({ error: "Invalid project ID" }); return; }
  try {
    res.json({ description: await describeWarehouse(id) });
  } catch (err) {
    req.log?.error({ err }, "warehouse-schema failed");
    res.json({ description: "" });
  }
});

router.post("/projects/:id/warehouse-query", async (req: Request, res: Response) => {
  const id = parseId(req.params.id as string);
  if (id === null) { res.status(400).json({ error: "Invalid project ID" }); return; }
  const sql = (req.body as { sql?: unknown })?.sql;
  if (typeof sql !== "string" || !sql.trim()) {
    res.status(400).json({ error: "sql is required" });
    return;
  }
  try {
    const result = await runWarehouseQuery(id, sql);
    res.json(result);
  } catch (err) {
    req.log?.error({ err }, "warehouse-query failed");
    res.status(500).json({ error: "Query failed", columns: [], rows: [], rowCount: 0 });
  }
});

export default router;
