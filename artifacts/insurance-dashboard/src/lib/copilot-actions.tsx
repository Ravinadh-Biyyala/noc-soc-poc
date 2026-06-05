// AG-UI frontend actions + readable context for the BI Companion (CopilotKit).
//
// useCopilotReadable feeds the agent ground truth (current page, projects,
// dashboards) so it can resolve "the 1st dashboard" / "project jdcj" to real
// ids. useCopilotAction registers browser-side tools the agent can CALL to
// drive the app: navigate, open a dashboard, switch a project tab, kick off
// dashboard generation, and pin a generated chart. Mounted once inside the
// CopilotKit provider (from the right-rail panel).

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCopilotAction, useCopilotReadable, useCopilotChat } from "@copilotkit/react-core";
import { TextMessage, Role } from "@copilotkit/runtime-client-gql";
import { useChatObserver } from "@/lib/chat-observer";
import { useGeneratedDashboards } from "@/lib/generated-dashboards";
import { useCustomDashboards } from "@/lib/custom-dashboards";
import { useToast } from "@/hooks/use-toast";

interface ProjectLite { id: number; name: string; status?: string }
interface DashLite { id: number; name: string }

const PROJECT_TABS = ["connect", "raw", "dashboards", "chat"] as const;

function useProjects() {
  return useQuery<ProjectLite[]>({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const r = await fetch("/api/workspaces", { credentials: "include" });
      if (!r.ok) return [];
      const rows = await r.json();
      return Array.isArray(rows) ? rows.map((w: any) => ({ id: w.id, name: w.name, status: w.status })) : [];
    },
    staleTime: 10_000,
  });
}

async function fetchProjectDashboards(projectId: number): Promise<DashLite[]> {
  const r = await fetch(`/api/projects/${projectId}/dashboards`, { credentials: "include" });
  if (!r.ok) return [];
  const body = await r.json();
  return (body.dashboards ?? []).map((d: any) => ({ id: d.id, name: d.name }));
}

export function CopilotActions() {
  const [location, setLocation] = useLocation();
  const { observation } = useChatObserver();
  const { dashboards: generatedDashboards } = useGeneratedDashboards();
  const { addChart } = useCustomDashboards();
  const { toast } = useToast();
  const qc = useQueryClient();

  const activeProjectId = observation.workspaceId;
  const projectsQuery = useProjects();
  const { appendMessage } = useCopilotChat();

  // "Explain this visual" — chart/table clicks dispatch `copilot:explain` with a
  // concise message (shown in chat) + the visual's data as hidden context. We
  // expose the data as a readable and append the concise message, so the bubble
  // stays clean while the agent still gets the numbers to explain.
  const [explainCtx, setExplainCtx] = useState<unknown>(null);
  const [pendingExplain, setPendingExplain] = useState<{ message: string } | null>(null);
  useEffect(() => {
    const onExplain = (e: Event) => {
      const detail = (e as CustomEvent).detail as { message?: string; context?: unknown } | undefined;
      if (!detail?.message) return;
      setExplainCtx(detail.context ?? null);
      setPendingExplain({ message: detail.message });
    };
    window.addEventListener("copilot:explain", onExplain);
    return () => window.removeEventListener("copilot:explain", onExplain);
  }, []);
  // Declared BEFORE the append effect so this readable registers first — the
  // agent has the visual's data in context when the explain message runs.
  useCopilotReadable({
    description:
      "The visual (chart/table) the user most recently clicked to have explained, including its data. Use this data to answer the current 'explain this …' request.",
    value: explainCtx ?? "(none)",
    available: explainCtx ? "enabled" : "disabled",
  });
  // Runs AFTER explainCtx commits, so the hidden context is in scope before the
  // message triggers the agent.
  useEffect(() => {
    if (pendingExplain?.message) {
      void appendMessage(new TextMessage({ content: pendingExplain.message, role: Role.User })).catch(() => {});
      setPendingExplain(null);
    }
  }, [pendingExplain, appendMessage]);

  // Keep the dashboards readable fresh: refetch whenever the route changes (a
  // dashboard may have just been generated), so the agent never sees a stale
  // "no dashboards" list.
  useEffect(() => {
    if (typeof activeProjectId === "number" && activeProjectId > 0) {
      qc.invalidateQueries({ queryKey: ["copilot-project-dashboards", activeProjectId] });
    }
  }, [location, activeProjectId, qc]);

  // Dashboards for the active project — lets the agent resolve names/indexes.
  // Distinct key (NOT "project-dashboards") to avoid colliding with
  // DashboardsPanel's query of the same name, which returns a different shape.
  const projDashQuery = useQuery<DashLite[]>({
    queryKey: ["copilot-project-dashboards", activeProjectId],
    queryFn: () => fetchProjectDashboards(activeProjectId as number),
    enabled: typeof activeProjectId === "number" && activeProjectId > 0,
    staleTime: 5_000,
  });

  // The active project's warehouse schema (tables/views + columns), exposed as a
  // reactive readable so the agent has the EXACT table names in context on every
  // request and never guesses — independent of the async instructions fetch.
  const whSchemaQuery = useQuery<string>({
    queryKey: ["copilot-warehouse-schema", activeProjectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${activeProjectId}/warehouse-schema`, { credentials: "include" });
      if (!r.ok) return "";
      return (await r.json()).description ?? "";
    },
    enabled: typeof activeProjectId === "number" && activeProjectId > 0,
    staleTime: 30_000,
  });

  // ── Readable context ───────────────────────────────────────────────────────
  useCopilotReadable({
    description: "The page the user is currently viewing, and the active project id (workspaceId) if inside a project.",
    value: {
      label: observation.label,
      kind: observation.kind,
      path: location,
      activeProjectId: activeProjectId ?? null,
      summary: observation.summary ?? null,
    },
  });

  useCopilotReadable({
    description: "All data projects. Use `id` for projectId in actions; resolve project names against `name`.",
    value: projectsQuery.data ?? [],
  });

  useCopilotReadable({
    description:
      "Dashboards in the ACTIVE project, in display order (index is 1-based, so the '1st dashboard' is index 1). Use `id` for openDashboard.",
    value: (projDashQuery.data ?? []).map((d, i) => ({ index: i + 1, id: d.id, name: d.name })),
  });

  useCopilotReadable({
    description: "Global generated dashboards (outside projects). Navigate with `route`.",
    value: generatedDashboards.map((d) => ({ name: d.title, route: d.route })),
  });

  useCopilotReadable({
    description:
      "The CURRENT project's warehouse schema (tables/views + columns). Use these EXACT names when calling query_project_warehouse — never guess. If this shows '(loading…)', call list_warehouse_tables first to fetch it before querying.",
    value: activeProjectId
      ? (whSchemaQuery.data && whSchemaQuery.data.trim()
          ? whSchemaQuery.data
          : "(loading… call list_warehouse_tables to fetch the exact table/column names before querying)")
      : "(not inside a project)",
    available: activeProjectId ? "enabled" : "disabled",
  });

  // ── Actions ──────────────────────────────────────────────────────────────────
  useCopilotAction({
    name: "navigateTo",
    description: "Navigate the browser to an app route. Core routes: /, /projects, /dashboards, /settings, /governance, /visuals-catalog.",
    parameters: [
      { name: "path", type: "string", description: "The route path to navigate to, e.g. '/dashboards' or '/projects/11/raw'.", required: true },
      { name: "reason", type: "string", description: "One short sentence shown to the user.", required: false },
    ],
    handler: async ({ path, reason }: { path: string; reason?: string }) => {
      setLocation(path);
      toast({ title: "Opening page…", description: reason || `Navigating to ${path}` });
      return `Navigated to ${path}.`;
    },
  });

  useCopilotAction({
    name: "openDashboard",
    description:
      "Open a specific dashboard inside a project. Resolve by dashboardId, else by name, else by 1-based index (e.g. 'the 1st dashboard'). If projectId is omitted, use the active project.",
    parameters: [
      { name: "projectId", type: "number", description: "Project id. Omit to use the active project.", required: false },
      { name: "dashboardId", type: "number", description: "Exact dashboard id, if known.", required: false },
      { name: "index", type: "number", description: "1-based position in the project's dashboard list.", required: false },
      { name: "name", type: "string", description: "Dashboard name (case-insensitive, partial match).", required: false },
    ],
    handler: async ({ projectId, dashboardId, index, name }: { projectId?: number; dashboardId?: number; index?: number; name?: string }) => {
      const pid = projectId ?? activeProjectId;
      if (!pid) return "No project specified and not currently inside a project.";
      const list = await fetchProjectDashboards(pid);
      if (list.length === 0) return `Project ${pid} has no dashboards yet. Use createProjectDashboard to generate one.`;
      let chosen: DashLite | undefined;
      if (dashboardId != null) chosen = list.find((d) => d.id === Number(dashboardId));
      if (!chosen && name) chosen = list.find((d) => d.name.toLowerCase().includes(name.toLowerCase()));
      if (!chosen && index != null) chosen = list[Number(index) - 1];
      if (!chosen) chosen = list[0];
      if (!chosen) return "Could not resolve a dashboard to open.";
      setLocation(`/projects/${pid}/dashboards/${chosen.id}`);
      toast({ title: "Opening dashboard", description: chosen.name });
      return `Opened "${chosen.name}".`;
    },
  });

  useCopilotAction({
    name: "switchProjectTab",
    description: "Switch the active tab inside a project: connect | raw | dashboards | chat.",
    parameters: [
      { name: "tab", type: "string", description: "One of: connect, raw, dashboards, chat.", required: true },
      { name: "projectId", type: "number", description: "Project id. Omit to use the active project.", required: false },
    ],
    handler: async ({ tab, projectId }: { tab: string; projectId?: number }) => {
      const pid = projectId ?? activeProjectId;
      if (!pid) return "Not currently inside a project.";
      const t = PROJECT_TABS.includes(tab as (typeof PROJECT_TABS)[number]) ? tab : "raw";
      setLocation(`/projects/${pid}/${t}`);
      return `Switched to the ${t} tab.`;
    },
  });

  useCopilotAction({
    name: "createProjectDashboard",
    description: "Start AI dashboard generation for a project (opens the multi-agent generation dialog on the Raw browser tab).",
    parameters: [
      { name: "projectId", type: "number", description: "Project id. Omit to use the active project.", required: false },
    ],
    handler: async ({ projectId }: { projectId?: number }) => {
      const pid = projectId ?? activeProjectId;
      if (!pid) return "Not currently inside a project — open a project first.";
      setLocation(`/projects/${pid}/raw`);
      // The Raw browser listens for this and opens the AutoGenerate dialog.
      window.dispatchEvent(new CustomEvent("copilot:create-dashboard", { detail: { projectId: pid } }));
      toast({ title: "Dashboard generation", description: "Opening the dashboard builder…" });
      return "Opened the dashboard builder for this project.";
    },
  });

  useCopilotAction({
    name: "list_warehouse_tables",
    description:
      "List the CURRENT project's warehouse tables/views and their columns. ALWAYS call this first (before query_project_warehouse) if you don't already have the exact table and column names — never guess table names.",
    parameters: [],
    handler: async () => {
      const pid = activeProjectId;
      if (!pid) return { error: "No active project. Open a project first.", description: "" };
      try {
        const r = await fetch(`/api/projects/${pid}/warehouse-schema`, { credentials: "include" });
        return await r.json();
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Failed to load schema", description: "" };
      }
    },
  });

  useCopilotAction({
    name: "query_project_warehouse",
    description:
      "Run a READ-ONLY SQL SELECT against the CURRENT project's curated warehouse (tables and views listed in the PROJECT WAREHOUSE section of your instructions). Use for any analytics question about the project — aggregations, rankings, trends, breakdowns, joins across its tables/views. Reference tables by bare name (the warehouse schema is on the search_path). Returns JSON rows to then visualise with pinChartToDashboard.",
    parameters: [
      { name: "sql", type: "string", description: "A single read-only SELECT/WITH query over the warehouse tables/views. Add LIMIT for large scans.", required: true },
    ],
    handler: async ({ sql }: { sql: string }) => {
      const pid = activeProjectId;
      if (!pid) return { error: "No active project. Open a project to query its warehouse.", columns: [], rows: [], rowCount: 0 };
      try {
        const r = await fetch(`/api/projects/${pid}/warehouse-query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ sql }),
        });
        return await r.json();
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Query failed", columns: [], rows: [], rowCount: 0 };
      }
    },
  });

  useCopilotAction({
    name: "pinChartToDashboard",
    description:
      "Pin a chart to the current dashboard view. Call AFTER execute_dataset_query, passing the rows as `data`. Numbers must be raw (no $ or commas).",
    parameters: [
      { name: "title", type: "string", description: "Chart title.", required: true },
      { name: "type", type: "string", description: "Chart type: bar | line | area | pie | donut.", required: true },
      { name: "xKey", type: "string", description: "Key in each data row for the category/x-axis.", required: true },
      { name: "yKey", type: "string", description: "Key in each data row for the numeric value/y-axis.", required: true },
      { name: "data", type: "string", description: 'A JSON array STRING of the row objects from the query, each containing xKey and yKey — e.g. \'[{"brand":"X","total_deal_value":123}]\'. Pass the real query rows, not a placeholder.', required: true },
      { name: "colors", type: "string", description: 'Optional: a JSON array STRING of hex colours YOU choose for the chart (e.g. \'["#1565C0","#2E7D32"]\') — pick a coherent, professional palette that suits the data (distinct hues for categories, a single hue for one series, red/green only where it carries meaning). Omit to use defaults.', required: false },
    ],
    handler: async ({ title, type, xKey, yKey, data, colors }: { title: string; type: string; xKey: string; yKey: string; data: unknown; colors?: unknown }) => {
      // `data` arrives as a JSON string (object[] params get their keys stripped
      // by strict tool schemas). Parse, then coerce numeric strings so Recharts
      // plots them on numeric axes.
      let parsed: any[] = [];
      if (typeof data === "string") { try { parsed = JSON.parse(data); } catch { parsed = []; } }
      else if (Array.isArray(data)) parsed = data;
      const coerced = (Array.isArray(parsed) ? parsed : []).map((row) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row ?? {})) {
          out[k] = typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : v;
        }
        return out;
      });
      if (coerced.length === 0) {
        return "No data rows were provided — re-run the query and pass the actual rows as a JSON array string in `data`, then call pinChartToDashboard again.";
      }
      // Optional AI-chosen palette (JSON string of hex colours).
      let palette: string[] | undefined;
      if (typeof colors === "string" && colors.trim()) {
        try {
          const parsedColors = JSON.parse(colors);
          if (Array.isArray(parsedColors)) {
            const valid = parsedColors.filter((c) => typeof c === "string" && /^(#|rgb|hsl)/i.test(c.trim()));
            if (valid.length) palette = valid;
          }
        } catch { /* ignore — fall back to default palette */ }
      } else if (Array.isArray(colors)) {
        const valid = (colors as unknown[]).filter((c) => typeof c === "string" && /^(#|rgb|hsl)/i.test((c as string).trim())) as string[];
        if (valid.length) palette = valid;
      }
      addChart({
        type,
        title,
        xKey,
        yKey,
        data: coerced,
        ...(palette ? { colors: palette } : {}),
        section: location,
        sectionLabel: observation.label,
      });
      toast({ title: "Pinned to dashboard", description: `"${title}" added to ${observation.label}.` });
      return `Pinned "${title}" to the current dashboard (${coerced.length} data points).`;
    },
  });

  return null;
}
