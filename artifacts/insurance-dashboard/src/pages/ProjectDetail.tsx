import { useMemo } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useGetWorkspace, getGetWorkspaceQueryKey } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useRegisterObservation } from "@/lib/chat-observer";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, AlertTriangle, Upload, Table, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectConnectDataPanel, ProjectRawBrowserPanel } from "@/components/project/DataEngineeringPanel";
import { ProjectDashboardsPanel } from "@/components/project/DashboardsPanel";

// The per-project Chat tab was removed — the right-rail BI Companion (Copilot)
// is the single place to chat with project data.
type Phase = "connect" | "raw" | "dashboards";

const VALID_TABS: ReadonlySet<Phase> = new Set(["connect", "raw", "dashboards"]);

interface WarehouseStatus {
  tableCount: number;
}

function useWarehouseStatus(projectId: number | null) {
  return useQuery<WarehouseStatus>({
    queryKey: ["project-warehouse-status", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/warehouse-status`, { credentials: "include" });
      if (!r.ok) {
        // Endpoint may not be deployed yet on first run; degrade gracefully.
        return { tableCount: 0 };
      }
      return r.json();
    },
    enabled: projectId !== null,
    staleTime: 10_000,
  });
}

export default function ProjectDetail() {
  const [, params] = useRoute("/projects/:id/:tab?");
  // Deep-link to a specific dashboard: /projects/:id/dashboards/:dashId
  const [matchDash, dashParams] = useRoute("/projects/:id/dashboards/:dashId");
  const [, setLocation] = useLocation();

  const idStr = (dashParams?.id ?? params?.id) ?? "";
  const tabParam = (matchDash ? "dashboards" : (params?.tab ?? "connect")) as Phase;
  const tab: Phase = VALID_TABS.has(tabParam) ? tabParam : "connect";
  const deepLinkDashId = dashParams?.dashId ? Number(dashParams.dashId) : undefined;

  const id = parseInt(idStr, 10);
  const validId = Number.isFinite(id) && id > 0 ? id : null;

  const lookupId = validId ?? 0;
  const { data: project, isLoading, error } = useGetWorkspace(lookupId, {
    query: { enabled: validId !== null, queryKey: getGetWorkspaceQueryKey(lookupId) },
  });
  const { data: warehouseStatus } = useWarehouseStatus(validId);

  useRegisterObservation(
    useMemo(() => {
      if (!project) return null;
      const phaseLabel: Record<Phase, string> = {
        "connect": "Connect to data (Bronze ingestion)",
        "raw": "Raw browser (Bronze layer)",
        "dashboards": "Dashboards",
      };
      return {
        label: `${project.name} — ${phaseLabel[tab]}`,
        kind: "workspace" as const,
        workspaceId: id,
        summary: `Project "${project.name}" (id=${id}). Current tab: ${phaseLabel[tab]}. Warehouse has ${warehouseStatus?.tableCount ?? 0} table(s). The active workspaceId for queries is ${id}.`,
        suggestions: [
          tab === "connect"
            ? "What data sources should I connect?"
            : tab === "raw"
              ? "What raw tables look most important?"
              : "Summarise what this dashboard shows",
          "What's the current state of this project?",
          "Show me insights from the data",
        ],
      };
    }, [project, tab, id, warehouseStatus?.tableCount]),
  );

  const goTab = (next: Phase) => setLocation(`/projects/${id}/${next}`);

  if (!validId) {
    return (
      <Card>
        <CardContent className="py-10 flex flex-col items-center gap-2 text-muted-foreground">
          <AlertTriangle className="w-6 h-6 text-amber-500" />
          <p className="text-sm">Invalid project URL.</p>
          <Link href="/projects">
            <Button variant="outline" size="sm">Back to projects</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <Card>
        <CardContent className="py-10 flex flex-col items-center gap-2 text-muted-foreground">
          <AlertTriangle className="w-6 h-6 text-amber-500" />
          <p className="text-sm">Project not found.</p>
          <Link href="/projects">
            <Button variant="outline" size="sm">Back to projects</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid={`page-project-${id}`}>
      <div className="flex items-center gap-3">
        <Link href="/projects">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="w-4 h-4" /> Projects
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-semibold tracking-tight truncate">{project.name}</h2>
          {project.description && (
            <p className="text-sm text-muted-foreground line-clamp-1">{project.description}</p>
          )}
        </div>
        <Badge variant="outline" className="text-[10px]">{project.status}</Badge>
      </div>

      <Tabs value={VALID_TABS.has(tab) ? tab : "connect"} onValueChange={(v) => goTab(v as Phase)}>
        <TabsList className="h-10 flex-wrap">
          <TabsTrigger value="connect" className="gap-1.5">
            <Upload className="w-3.5 h-3.5" /> Connect to data
          </TabsTrigger>
          <TabsTrigger value="raw" className="gap-1.5">
            <Table className="w-3.5 h-3.5" /> Raw browser
          </TabsTrigger>
          <TabsTrigger value="dashboards" className="gap-1.5">
            <LayoutDashboard className="w-3.5 h-3.5" /> Dashboards
          </TabsTrigger>
        </TabsList>

        <TabsContent value="connect" className="pt-4">
          <ProjectConnectDataPanel projectId={id} onImported={() => goTab("raw")} />
        </TabsContent>
        <TabsContent value="raw" className="pt-4">
          <ProjectRawBrowserPanel
            projectId={id}
            onDashboardCreated={() => goTab("dashboards")}
          />
        </TabsContent>
        <TabsContent value="dashboards" className="pt-4">
          <ProjectDashboardsPanel projectId={id} projectName={project.name} initialDashId={deepLinkDashId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
