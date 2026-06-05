import { useState, useEffect, useMemo, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRegisterObservation } from "@/lib/chat-observer";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import GeneratedDashboard from "@/components/GeneratedDashboard";
import {
  Loader2, RefreshCw,
  ArrowLeft, LayoutDashboard, FileText, ChevronDown, ChevronRight,
} from "lucide-react";

interface Props { projectId: number; projectName: string; initialDashId?: number }

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

export function ProjectDashboardsPanel({ projectId, projectName, initialDashId }: Props) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const listQuery = useProjectDashboards(projectId);
  const [openDashId, setOpenDashId] = useState<number | null>(initialDashId ?? null);

  // Deep-link / Copilot openDashboard: react when the URL's :dashId changes.
  useEffect(() => {
    if (initialDashId != null) setOpenDashId(initialDashId);
  }, [initialDashId]);

  const dashboards = listQuery.data?.dashboards ?? [];
  // A project carries a single generated dashboard, so when exactly one exists
  // show it directly — no list/card step. Only keep the list (and the "Back"
  // button) when there's more than one to choose between.
  const single = dashboards.length === 1;
  const effectiveOpenId = openDashId ?? (single ? dashboards[0].id : null);

  const openDash = (id: number) => {
    setOpenDashId(id);
    setLocation(`/projects/${projectId}/dashboards/${id}`);
  };
  const closeDash = () => {
    setOpenDashId(null);
    setLocation(`/projects/${projectId}/dashboards`);
  };

  if (effectiveOpenId !== null) {
    return (
      <div className="space-y-3">
        {/* Only offer "Back" when there's actually a list to return to. */}
        {dashboards.length > 1 && (
          <Button size="sm" variant="outline" onClick={closeDash} className="gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to dashboards
          </Button>
        )}
        <DashboardViewer projectId={projectId} dashId={effectiveOpenId} />
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
        <Button
          size="sm"
          variant="outline"
          onClick={() => qc.invalidateQueries({ queryKey: ["project-dashboards", projectId] })}
          className="gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      {listQuery.isLoading ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading…
          </CardContent>
        </Card>
      ) : dashboards.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No dashboards yet. Use the Chat tab to generate visuals.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {dashboards.map((d) => (
            <Card
              key={d.id}
              onClick={() => openDash(d.id)}
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
  const detail = useQuery<ProjectDashboardDetail>({
    queryKey: ["project-dashboard", projectId, dashId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/dashboards/${dashId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load dashboard");
      return r.json();
    },
  });

  // Tell the right-rail Copilot what's on screen — crucially with the project's
  // workspaceId — so it keeps project context (and can reference the visible
  // KPIs/charts) while a dashboard is open. Must run before the early returns.
  const data = detail.data;
  useRegisterObservation(
    useMemo(() => {
      if (!data) return null;
      const cfg = (data.config ?? {}) as { title?: string; kpis?: Array<{ label: string; value: unknown }>; charts?: Array<{ title: string; type: string }> };
      const kpis = cfg.kpis ?? [];
      const charts = cfg.charts ?? [];
      return {
        label: data.name,
        kind: "dashboard" as const,
        workspaceId: projectId,
        summary:
          `User is viewing the generated dashboard "${data.name}" in project id=${projectId}. ` +
          (kpis.length ? `KPIs: ${kpis.map((k) => `${k.label}=${String(k.value)}`).join(", ")}. ` : "") +
          (charts.length ? `Charts: ${charts.map((c) => `${c.title} (${c.type})`).join("; ")}. ` : "") +
          `The active project / workspaceId for any data query or action is ${projectId}.`,
        suggestions: [
          `Summarise the "${data.name}" dashboard`,
          charts[0] ? `Explain the "${charts[0].title}" chart` : "What stands out in this data?",
          "Which metric needs the most attention?",
        ],
      };
    }, [data, projectId]),
  );

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
      <GeneratedDashboard config={detail.data.config} hidePresenter />
      {detail.data.report && <ReportSection markdown={detail.data.report} />}
    </div>
  );
}

/** Collapsible narrative report rendered below the charts (auto-mode dashboards).
 *  Collapsed by default so the dashboard visuals lead; the user expands it on demand.
 *  Lightweight markdown: #/## headings, "- " bullets, and paragraphs. */
function ReportSection({ markdown }: { markdown: string }) {
  const [open, setOpen] = useState(false);
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
