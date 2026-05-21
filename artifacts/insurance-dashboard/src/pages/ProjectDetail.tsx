import { useMemo } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useGetWorkspace, getGetWorkspaceQueryKey } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useRegisterObservation } from "@/lib/chat-observer";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, AlertTriangle, Wrench, LayoutDashboard, MessageSquare, Lock, Network, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectDataEngineeringPanel } from "@/components/project/DataEngineeringPanel";
import { ProjectDashboardsPanel } from "@/components/project/DashboardsPanel";
import { ProjectChatPanel } from "@/components/project/ChatPanel";
import { ProjectSemanticModelPanel } from "@/components/project/SemanticModelPanel";
import { ProjectMetricArchitectPanel } from "@/components/project/MetricArchitectPanel";

type Phase = "data-engineering" | "semantic-model" | "metrics" | "dashboards" | "chat";

const VALID_TABS: ReadonlySet<Phase> = new Set([
  "data-engineering",
  "semantic-model",
  "metrics",
  "dashboards",
  "chat",
]);

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
  const [, setLocation] = useLocation();

  const idStr = params?.id ?? "";
  const tabParam = (params?.tab ?? "data-engineering") as Phase;
  const tab: Phase = VALID_TABS.has(tabParam) ? tabParam : "data-engineering";

  const id = parseInt(idStr, 10);
  const validId = Number.isFinite(id) && id > 0 ? id : null;

  const lookupId = validId ?? 0;
  const { data: project, isLoading, error } = useGetWorkspace(lookupId, {
    query: { enabled: validId !== null, queryKey: getGetWorkspaceQueryKey(lookupId) },
  });
  const { data: warehouseStatus } = useWarehouseStatus(validId);
  const warehouseReady = (warehouseStatus?.tableCount ?? 0) > 0;

  useRegisterObservation(
    useMemo(() => {
      if (!project) return null;
      const phaseLabel: Record<Phase, string> = {
        "data-engineering": "Data Engineering (Bronze → Silver)",
        "semantic-model": "Semantic Model (Silver → Semantic)",
        "metrics": "Metric Architect (Gold layer)",
        "dashboards": "Dashboards",
        "chat": "Analyst Chat",
      };
      return {
        label: `${project.name} — ${phaseLabel[tab]}`,
        kind: "workspace" as const,
        workspaceId: id,
        summary: `Project "${project.name}" (id=${id}). Current phase: ${phaseLabel[tab]}. Warehouse has ${warehouseStatus?.tableCount ?? 0} table(s). The project pipeline goes: Data Engineering proposes cleaning transformations → Semantic Model defines fact/dim/joins → Metric Architect defines KPI formulas → Dashboards and Chat consume the model and metrics. The active workspaceId for queries is ${id}.`,
        suggestions: [
          tab === "data-engineering"
            ? "What raw tables look most important?"
            : tab === "semantic-model"
              ? "Which tables look like facts vs dimensions?"
              : tab === "metrics"
                ? "What standard KPIs should I define?"
                : tab === "dashboards"
                  ? "Summarise what this dashboard shows"
                  : "What's the most interesting number in my warehouse?",
          "What's blocking me from advancing to the next phase?",
          "Audit my pipeline so far",
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

      <Tabs value={tab} onValueChange={(v) => goTab(v as Phase)}>
        <TabsList className="h-10 flex-wrap">
          <TabsTrigger value="data-engineering" className="gap-1.5">
            <Wrench className="w-3.5 h-3.5" /> Data Engineering
          </TabsTrigger>
          <TabsTrigger value="semantic-model" disabled={!warehouseReady} className="gap-1.5">
            {warehouseReady ? <Network className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            Semantic Model
          </TabsTrigger>
          <TabsTrigger value="metrics" disabled={!warehouseReady} className="gap-1.5">
            {warehouseReady ? <Gauge className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            Metrics
          </TabsTrigger>
          <TabsTrigger value="dashboards" disabled={!warehouseReady} className="gap-1.5">
            {warehouseReady ? <LayoutDashboard className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            Dashboards
          </TabsTrigger>
          <TabsTrigger value="chat" disabled={!warehouseReady} className="gap-1.5">
            {warehouseReady ? <MessageSquare className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            Chat
          </TabsTrigger>
        </TabsList>

        <TabsContent value="data-engineering" className="pt-4">
          <ProjectDataEngineeringPanel projectId={id} projectName={project.name} />
        </TabsContent>
        <TabsContent value="semantic-model" className="pt-4">
          {warehouseReady ? (
            <ProjectSemanticModelPanel projectId={id} projectName={project.name} />
          ) : (
            <WarehouseEmptyCard />
          )}
        </TabsContent>
        <TabsContent value="metrics" className="pt-4">
          {warehouseReady ? (
            <ProjectMetricArchitectPanel projectId={id} projectName={project.name} />
          ) : (
            <WarehouseEmptyCard />
          )}
        </TabsContent>
        <TabsContent value="dashboards" className="pt-4">
          {warehouseReady ? (
            <ProjectDashboardsPanel projectId={id} projectName={project.name} />
          ) : (
            <WarehouseEmptyCard />
          )}
        </TabsContent>
        <TabsContent value="chat" className="pt-4">
          {warehouseReady ? (
            <ProjectChatPanel projectId={id} />
          ) : (
            <WarehouseEmptyCard />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function WarehouseEmptyCard() {
  return (
    <Card>
      <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
          <Lock className="w-6 h-6 text-muted-foreground" />
        </div>
        <div>
          <p className="text-base font-semibold">Data warehouse is empty</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md">
            Finish the Data Engineering phase to populate the warehouse schema. Once you accept
            and save at least one transformation, this section unlocks.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
