import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import GeneratedDashboard from "@/components/GeneratedDashboard";
import {
  Loader2, RefreshCw, AlertTriangle,
  ArrowLeft, LayoutDashboard, Plus, FileText, ChevronDown, ChevronRight,
} from "lucide-react";

interface Props { projectId: number; projectName: string }

interface DashboardListItem { id: number; name: string; createdAt: string; updatedAt: string }
interface ProjectDashboardDetail { id: number; name: string; config: unknown; report?: string | null }

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

export function ProjectDashboardsPanel({ projectId, projectName }: Props) {
  const qc = useQueryClient();
  const listQuery = useProjectDashboards(projectId);
  const [openDashId, setOpenDashId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dashboards = listQuery.data?.dashboards ?? [];

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
      if (!body.created) throw new Error("Agent did not create a dashboard. Try again.");
      qc.invalidateQueries({ queryKey: ["project-dashboards", projectId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

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
          <p className="text-sm font-medium">Dashboards</p>
          <p className="text-xs text-muted-foreground">
            Generated dashboards for <span className="font-medium">{projectName}</span>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => qc.invalidateQueries({ queryKey: ["project-dashboards", projectId] })}
            className="gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
          <Button size="sm" onClick={generateDashboard} disabled={generating} className="gap-1.5">
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {generating ? "Generating…" : "New dashboard"}
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

      {listQuery.isLoading ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading…
          </CardContent>
        </Card>
      ) : dashboards.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No dashboards yet. Click <span className="font-medium">New dashboard</span> to generate one.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {dashboards.map((d) => (
            <Card
              key={d.id}
              onClick={() => setOpenDashId(d.id)}
              className="cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all"
            >
              <CardContent className="py-4 space-y-1">
                <div className="flex items-center gap-2 font-medium text-sm">
                  <LayoutDashboard className="w-4 h-4 text-primary" />
                  {d.name}
                </div>
                <p className="text-xs text-muted-foreground">
                  Created {new Date(d.createdAt).toLocaleDateString()}
                </p>
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

  if (detail.isLoading) return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading dashboard…
      </CardContent>
    </Card>
  );
  if (detail.isError || !detail.data) return (
    <Card>
      <CardContent className="py-6 text-center text-sm text-destructive">Failed to load dashboard.</CardContent>
    </Card>
  );

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
      {detail.data.report && <ReportSection markdown={detail.data.report} />}
      <GeneratedDashboard config={detail.data.config} hidePresenter />
    </div>
  );
}

/** Collapsible narrative report rendered above the charts (auto-mode dashboards).
 *  Lightweight markdown: #/## headings, "- " bullets, and paragraphs. */
function ReportSection({ markdown }: { markdown: string }) {
  const [open, setOpen] = useState(true);
  return (
    <Card>
      <CardContent className="p-0">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-2 px-4 py-3 text-left font-medium text-sm hover:bg-muted/50"
          data-testid="report-toggle"
        >
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <FileText className="w-4 h-4 text-primary" />
          Insight Report
        </button>
        {open && (
          <div className="px-5 pb-5 pt-1 space-y-1.5 text-sm">
            {renderMarkdown(markdown)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function renderMarkdown(md: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = md.split("\n");
  let bullets: ReactNode[] = [];
  const flushBullets = () => {
    if (bullets.length) {
      out.push(
        <ul key={`ul-${out.length}`} className="list-disc pl-5 space-y-0.5 text-muted-foreground">
          {bullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("# ")) { flushBullets(); out.push(<h3 key={out.length} className="text-base font-semibold pt-1">{line.slice(2)}</h3>); }
    else if (line.startsWith("## ")) { flushBullets(); out.push(<h4 key={out.length} className="text-sm font-semibold pt-1.5">{line.slice(3)}</h4>); }
    else if (line.startsWith("- ")) { bullets.push(stripBold(line.slice(2))); }
    else if (line.trim() === "") { flushBullets(); }
    else { flushBullets(); out.push(<p key={out.length} className="text-muted-foreground">{stripBold(line)}</p>); }
  }
  flushBullets();
  return out;
}

/** Render **bold** segments inline. */
function stripBold(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i} className="text-foreground font-medium">{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>,
  );
}
