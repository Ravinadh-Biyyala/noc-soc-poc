import { useState } from "react";
import { Link } from "wouter";
import { useListWorkspaces } from "@workspace/api-client-react";
import { getPack } from "@/lib/domain-packs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CreateWorkspaceDialog } from "@/components/CreateWorkspaceDialog";
import { Plus, Briefcase, AlertTriangle, FileSpreadsheet, LayoutDashboard, User } from "lucide-react";
import { cn } from "@/lib/utils";

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

export default function WorkspacesList() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading, error } = useListWorkspaces();

  return (
    <div className="space-y-6 max-w-6xl" data-testid="page-workspaces">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Workspaces</h2>
          <p className="text-sm text-muted-foreground mt-1">
            One workspace per business question or dataset. Each is seeded by a domain pack.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-new-workspace">
          <Plus className="w-4 h-4 mr-2" /> New workspace
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
            <p className="text-sm">Could not load workspaces.</p>
          </CardContent>
        </Card>
      ) : (data?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Briefcase className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-base font-semibold">No workspaces yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                Create your first workspace to start uploading data, building metrics, and generating dashboards.
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)} className="mt-2">
              <Plus className="w-4 h-4 mr-2" /> Create workspace
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data!.map((w) => {
            const pack = getPack(w.packId);
            const PackIcon = pack.icon;
            return (
              <Link key={w.id} href={`/workspaces/${w.id}`}>
                <Card
                  className="cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                  data-testid={`workspace-card-${w.id}`}
                >
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <PackIcon className="w-4.5 h-4.5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{w.name}</p>
                          <p className="text-[11px] text-muted-foreground">{pack.label}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className={cn("text-[10px]", statusTone(w.status))}>
                        {w.status}
                      </Badge>
                    </div>

                    {w.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{w.description}</p>
                    )}

                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-2 border-t">
                      <span className="flex items-center gap-1">
                        <FileSpreadsheet className="w-3 h-3" /> {w.fileCount}
                      </span>
                      <span className="flex items-center gap-1">
                        <LayoutDashboard className="w-3 h-3" /> {w.dashboardCount}
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" /> {w.ownerName}
                      </span>
                      <span className="ml-auto">Readiness {w.readinessScore}%</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
