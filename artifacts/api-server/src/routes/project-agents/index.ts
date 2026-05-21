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
import { db, workspaces as workspacesTable, getProjectSchemaName, listWarehouseTables } from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildDataEngineerPrompt } from "../../agents/data-engineer/system-prompt";
import { buildDataModelerPrompt } from "../../agents/data-modeler/system-prompt";
import { buildAnalystChatPrompt } from "../../agents/analyst-chat/system-prompt";
import { DATA_ENGINEER_OPENAI_TOOLS } from "../../agents/data-engineer/tools";
import { DATA_MODELER_OPENAI_TOOLS } from "../../agents/data-modeler/tools";
import { ANALYST_CHAT_OPENAI_TOOLS } from "../../agents/analyst-chat/tools";

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

export default router;
