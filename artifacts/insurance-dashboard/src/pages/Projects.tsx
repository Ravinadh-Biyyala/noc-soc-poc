import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useListWorkspaces } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { Plus, FolderKanban, AlertTriangle, FileSpreadsheet, LayoutDashboard, User, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRegisterObservation } from "@/lib/chat-observer";

function statusTone(status: string) {
  switch (status) {
    case "active":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "archived":
      return "bg-muted text-muted-foreground border-border";
    default:
      return "bg-amber-50 text-amber-700 border-amber-200";
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export default function Projects() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading, error } = useListWorkspaces();

  useRegisterObservation(
    useMemo(() => {
      const count = data?.length ?? 0;
      const names = (data ?? []).slice(0, 5).map((p) => p.name).join(", ");
      return {
        label: "Projects",
        kind: "workspaces" as const,
        summary: `User is on the Projects list. ${count} project(s) total${names ? `: ${names}` : ""}. Each project runs the three-phase agent pipeline (Data Engineering → Semantic Model → Metrics → Dashboards → Chat).`,
        suggestions: [
          "Which project should I work on next?",
          "Compare my projects' readiness",
          "What's missing in any project to start querying?",
        ],
      };
    }, [data]),
  );

  return (
    <div className="space-y-6 max-w-6xl" data-testid="page-projects">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Projects</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Each project has its own raw + warehouse Postgres schemas and walks through
            three AI-assisted phases: Data Engineering → Dashboards → Chat.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-new-project">
          <Plus className="w-4 h-4 mr-2" /> Create project
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-10 flex flex-col items-center gap-2 text-muted-foreground">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
            <p className="text-sm">Could not load projects.</p>
          </CardContent>
        </Card>
      ) : (data?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <FolderKanban className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-base font-semibold">No projects yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                Create your first project to ingest data, transform it with AI assistance, and
                build dashboards.
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)} className="mt-2">
              <Plus className="w-4 h-4 mr-2" /> Create project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data!.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <Card
                className="cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                data-testid={`project-card-${p.id}`}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <FolderKanban className="w-4.5 h-4.5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{p.name}</p>
                        <p className="text-[11px] text-muted-foreground">Project #{p.id}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className={cn("text-[10px]", statusTone(p.status))}>
                      {p.status}
                    </Badge>
                  </div>

                  {p.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>
                  )}

                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-2 border-t">
                    <span className="flex items-center gap-1">
                      <FileSpreadsheet className="w-3 h-3" /> {p.fileCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <LayoutDashboard className="w-3 h-3" /> {p.dashboardCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" /> {p.ownerName}
                    </span>
                  </div>
                  <div
                    className="flex items-center gap-1 text-[10px] text-muted-foreground"
                    data-testid={`project-updated-${p.id}`}
                  >
                    <Clock className="w-3 h-3" />
                    <span>Updated {formatRelative(p.updatedAt)}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
