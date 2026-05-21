import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import GeneratedDashboard from "@/components/GeneratedDashboard";
import {
  Sparkles, GitBranch, Loader2, RefreshCw, Database, AlertTriangle,
  CheckCircle2, XCircle, Trash2, ArrowLeft, LayoutDashboard, Plus,
} from "lucide-react";

interface Props { projectId: number; projectName: string }

type Sub = "modeling" | "dashboards";

export function ProjectDashboardsPanel({ projectId, projectName }: Props) {
  const [sub, setSub] = useState<Sub>("modeling");
  return (
    <Tabs value={sub} onValueChange={(v) => setSub(v as Sub)}>
      <TabsList>
        <TabsTrigger value="modeling">
          <GitBranch className="w-3.5 h-3.5 mr-1.5" /> Data modeling
        </TabsTrigger>
        <TabsTrigger value="dashboards">
          <LayoutDashboard className="w-3.5 h-3.5 mr-1.5" /> Dashboards
        </TabsTrigger>
      </TabsList>
      <TabsContent value="modeling" className="pt-4">
        <ModelingTab projectId={projectId} projectName={projectName} onDashboardCreated={() => setSub("dashboards")} />
      </TabsContent>
      <TabsContent value="dashboards" className="pt-4">
        <DashboardsTab projectId={projectId} projectName={projectName} />
      </TabsContent>
    </Tabs>
  );
}

// ===========================================================================
// MODELING TAB — warehouse tables, relationship proposals, accept/reject.
// ===========================================================================

interface WarehouseTable { tableName: string; rowCount: number; columns: { name: string; type: string }[] }
interface Relationship {
  id: number; projectId: number;
  sourceTable: string; sourceColumn: string;
  targetTable: string; targetColumn: string;
  cardinality: string;
  status: "proposed" | "accepted" | "rejected";
  agentRationale: string | null;
  createdAt: string;
}

function useWarehouseTables(projectId: number) {
  return useQuery<{ tables: WarehouseTable[] }>({
    queryKey: ["project-warehouse-tables", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/warehouse-tables`, { credentials: "include" });
      if (!r.ok) return { tables: [] };
      return r.json();
    },
    staleTime: 5_000,
  });
}

function useRelationships(projectId: number) {
  return useQuery<{ relationships: Relationship[] }>({
    queryKey: ["project-relationships", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/relationships`, { credentials: "include" });
      if (!r.ok) return { relationships: [] };
      return r.json();
    },
    staleTime: 5_000,
  });
}

function ModelingTab({ projectId, projectName, onDashboardCreated }: { projectId: number; projectName: string; onDashboardCreated: () => void }) {
  const qc = useQueryClient();
  const tablesQuery = useWarehouseTables(projectId);
  const relsQuery = useRelationships(projectId);

  const [suggesting, setSuggesting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tables = tablesQuery.data?.tables ?? [];
  const rels = relsQuery.data?.relationships ?? [];
  const proposed = rels.filter((r) => r.status === "proposed");
  const accepted = rels.filter((r) => r.status === "accepted");

  const askForSuggestions = async () => {
    setSuggesting(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/agents/data-modeler/suggest-relationships`, {
        method: "POST",
        credentials: "include",
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Agent failed");
      qc.invalidateQueries({ queryKey: ["project-relationships", projectId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSuggesting(false);
    }
  };

  const generateDashboard = async () => {
    setGenerating(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/agents/data-modeler/generate-dashboard`, {
        method: "POST",
        credentials: "include",
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Dashboard generation failed");
      if (!body.created) throw new Error("Agent did not call create_dashboard. Try again.");
      qc.invalidateQueries({ queryKey: ["project-dashboards", projectId] });
      onDashboardCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <p className="text-sm font-medium">DataModelerAgent</p>
          <p className="text-xs text-muted-foreground">
            Reads warehouse tables in <code className="text-xs bg-muted px-1.5 py-0.5 rounded">proj_{projectId}</code> and proposes relationships for <span className="font-medium">{projectName}</span>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={askForSuggestions} disabled={suggesting || tables.length < 2} className="gap-1.5">
            {suggesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {suggesting ? "Thinking…" : "Suggest relationships"}
          </Button>
          <Button size="sm" onClick={generateDashboard} disabled={generating || tables.length === 0} className="gap-1.5">
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {generating ? "Generating…" : "Generate dashboard"}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-3 text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </CardContent>
        </Card>
      )}

      <WarehouseSchemaView tables={tables} loading={tablesQuery.isLoading} />

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Proposed relationships</p>
        {proposed.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">
            {tables.length < 2
              ? "Need at least 2 warehouse tables before modeling. Apply more transformations first."
              : `Click "Suggest relationships" to ask the agent.`}
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {proposed.map((r) => <RelationshipCard key={r.id} relationship={r} projectId={projectId} />)}
          </div>
        )}
      </div>

      {accepted.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Accepted relationships ({accepted.length})</p>
          <div className="space-y-2">
            {accepted.map((r) => <RelationshipCard key={r.id} relationship={r} projectId={projectId} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function WarehouseSchemaView({ tables, loading }: { tables: WarehouseTable[]; loading: boolean }) {
  if (loading) return <Card><CardContent className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Reading warehouse…</CardContent></Card>;
  if (tables.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Warehouse schema</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {tables.map((t) => (
          <Card key={t.tableName}>
            <CardContent className="py-3 space-y-1">
              <div className="flex items-center gap-2 font-medium text-sm">
                <Database className="w-3.5 h-3.5 text-primary" />
                {t.tableName}
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 ml-auto">{t.rowCount} rows</Badge>
              </div>
              <ul className="text-xs text-muted-foreground space-y-0.5 max-h-32 overflow-y-auto">
                {t.columns.map((c) => (
                  <li key={c.name} className="flex justify-between gap-2">
                    <span className="truncate">{c.name}</span>
                    <span className="text-[10px] opacity-60 flex-shrink-0">{c.type}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RelationshipCard({ relationship, projectId }: { relationship: Relationship; projectId: number }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["project-relationships", projectId] });

  const call = async (action: "accept" | "reject" | "delete") => {
    setBusy(true);
    try {
      if (action === "delete") {
        await fetch(`/api/projects/${projectId}/relationships/${relationship.id}`, { method: "DELETE", credentials: "include" });
      } else {
        await fetch(`/api/projects/${projectId}/relationships/${relationship.id}/${action}`, { method: "POST", credentials: "include" });
      }
      invalidate();
    } finally { setBusy(false); }
  };

  const statusColor = relationship.status === "accepted" ? "bg-green-50 text-green-700 border-green-200"
    : relationship.status === "proposed" ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-muted text-muted-foreground";

  return (
    <Card>
      <CardContent className="py-3 space-y-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-sm">
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{relationship.sourceTable}.{relationship.sourceColumn}</code>
            <span className="text-muted-foreground">→</span>
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{relationship.targetTable}.{relationship.targetColumn}</code>
            <Badge variant="outline" className="text-[10px] py-0 px-1.5">{relationship.cardinality}</Badge>
          </div>
          <Badge className={`text-[10px] uppercase ${statusColor}`} variant="outline">{relationship.status}</Badge>
        </div>
        {relationship.agentRationale && (
          <p className="text-xs text-muted-foreground italic">{relationship.agentRationale}</p>
        )}
        <div className="flex gap-2">
          {relationship.status === "proposed" && (
            <>
              <Button size="sm" variant="outline" onClick={() => call("accept")} disabled={busy} className="gap-1 h-7 text-xs">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> Accept
              </Button>
              <Button size="sm" variant="outline" onClick={() => call("reject")} disabled={busy} className="gap-1 h-7 text-xs">
                <XCircle className="w-3.5 h-3.5 text-muted-foreground" /> Reject
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => call("delete")} disabled={busy} className="gap-1 h-7 text-xs ml-auto">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// DASHBOARDS TAB — list of generated dashboards + viewer.
// ===========================================================================

interface DashboardListItem { id: number; name: string; createdAt: string; updatedAt: string }

function useProjectDashboards(projectId: number) {
  return useQuery<{ dashboards: DashboardListItem[] }>({
    queryKey: ["project-dashboards", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/dashboards`, { credentials: "include" });
      if (!r.ok) return { dashboards: [] };
      return r.json();
    },
    staleTime: 5_000,
  });
}

interface ProjectDashboardDetail { id: number; name: string; config: unknown }

function DashboardsTab({ projectId, projectName }: { projectId: number; projectName: string }) {
  const qc = useQueryClient();
  const listQuery = useProjectDashboards(projectId);
  const [openDashId, setOpenDashId] = useState<number | null>(null);

  const dashboards = listQuery.data?.dashboards ?? [];

  if (openDashId !== null) {
    return (
      <div className="space-y-3">
        <Button size="sm" variant="outline" onClick={() => setOpenDashId(null)} className="gap-1.5">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to dashboards
        </Button>
        <DashboardViewer projectId={projectId} dashId={openDashId} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Generated dashboards</p>
          <p className="text-xs text-muted-foreground">
            Dashboards built by DataModelerAgent for <span className="font-medium">{projectName}</span>.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["project-dashboards", projectId] })} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      {listQuery.isLoading ? (
        <Card><CardContent className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading…</CardContent></Card>
      ) : dashboards.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No dashboards yet. Go to <span className="font-medium">Data modeling → Generate dashboard</span> to ask the agent to build one.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {dashboards.map((d) => (
            <Card key={d.id} onClick={() => setOpenDashId(d.id)} className="cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all">
              <CardContent className="py-4 space-y-1">
                <div className="flex items-center gap-2 font-medium text-sm">
                  <LayoutDashboard className="w-4 h-4 text-primary" />
                  {d.name}
                </div>
                <p className="text-xs text-muted-foreground">Created {new Date(d.createdAt).toLocaleDateString()}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function DashboardViewer({ projectId, dashId }: { projectId: number; dashId: number }) {
  const qc = useQueryClient();
  const detail = useQuery<ProjectDashboardDetail>({
    queryKey: ["project-dashboard", projectId, dashId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/dashboards/${dashId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load dashboard");
      return r.json();
    },
  });

  if (detail.isLoading) return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading dashboard…</CardContent></Card>;
  if (detail.isError || !detail.data) return <Card><CardContent className="py-6 text-center text-sm text-destructive">Failed to load dashboard.</CardContent></Card>;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() => qc.invalidateQueries({ queryKey: ["project-dashboard", projectId, dashId] })}
          disabled={detail.isFetching}
          className="gap-1.5"
        >
          {detail.isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh data
        </Button>
      </div>
      <GeneratedDashboard config={detail.data.config} hidePresenter />
    </div>
  );
}
