import { useState } from "react";
import { Link } from "wouter";
import { useListWorkspaces } from "@workspace/api-client-react";
import { useGeneratedDashboards } from "@/lib/generated-dashboards";
import { getPack } from "@/lib/domain-packs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateWorkspaceDialog } from "@/components/CreateWorkspaceDialog";
import {
  Plus,
  Briefcase,
  LayoutDashboard,
  Lightbulb,
  CheckSquare,
  AlertTriangle,
  Upload,
  ArrowRight,
  Sparkles,
} from "lucide-react";

function EmptyState({ icon: Icon, label, action }: { icon: React.ComponentType<{ className?: string }>; label: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground gap-2">
      <Icon className="w-6 h-6 opacity-50" />
      <p className="text-xs">{label}</p>
      {action}
    </div>
  );
}

export default function Home() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data: workspaces, isLoading: wsLoading, error: wsError } = useListWorkspaces();
  const { dashboards } = useGeneratedDashboards();

  const recentWorkspaces = (workspaces ?? []).slice(0, 4);
  const recentDashboards = dashboards.slice(0, 4);

  return (
    <div className="space-y-6 max-w-6xl" data-testid="page-home">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Welcome to Gen-BI</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Spin up a workspace, drop in your data, and let the Copilot do the analysis.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/upload">
            <Button variant="outline" size="sm" data-testid="link-upload">
              <Upload className="w-4 h-4 mr-2" /> Upload data
            </Button>
          </Link>
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-new-workspace">
            <Plus className="w-4 h-4 mr-2" /> New workspace
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-primary" /> Recent workspaces
              </CardTitle>
              <CardDescription className="text-xs">Jump back into recent analysis.</CardDescription>
            </div>
            <Link href="/workspaces">
              <button className="text-[11px] text-primary hover:underline">View all</button>
            </Link>
          </CardHeader>
          <CardContent>
            {wsLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-md" />)}
              </div>
            ) : wsError ? (
              <EmptyState icon={AlertTriangle} label="Could not load workspaces." />
            ) : recentWorkspaces.length === 0 ? (
              <EmptyState
                icon={Briefcase}
                label="No workspaces yet."
                action={
                  <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                    Create your first
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-1">
                {recentWorkspaces.map((w) => {
                  const pack = getPack(w.packId);
                  const PackIcon = pack.icon;
                  return (
                    <li key={w.id}>
                      <Link href={`/workspaces/${w.id}`}>
                        <div
                          className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/40 cursor-pointer group"
                          data-testid={`workspace-card-${w.id}`}
                        >
                          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <PackIcon className="w-4 h-4 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-foreground truncate">{w.name}</div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              {pack.label} · {w.fileCount} files · {w.dashboardCount} dashboards
                            </div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <LayoutDashboard className="w-4 h-4 text-primary" /> Recent dashboards
            </CardTitle>
            <CardDescription className="text-xs">Generated from your uploads.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentDashboards.length === 0 ? (
              <EmptyState
                icon={LayoutDashboard}
                label="No dashboards yet — upload a CSV to generate one."
                action={
                  <Link href="/upload">
                    <Button size="sm" variant="outline">Upload data</Button>
                  </Link>
                }
              />
            ) : (
              <ul className="space-y-1">
                {recentDashboards.map((d) => (
                  <li key={d.id}>
                    <Link href={d.route}>
                      <div className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/40 cursor-pointer">
                        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <LayoutDashboard className="w-4 h-4 text-primary" />
                        </div>
                        <div className="text-sm font-medium text-foreground truncate flex-1">{d.title}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-primary" /> Saved insights
            </CardTitle>
            <CardDescription className="text-xs">Pinned answers from the Copilot.</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState icon={Lightbulb} label="Insights you pin will live here." />
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-primary" /> Pending approvals
            </CardTitle>
            <CardDescription className="text-xs">Metrics or reports awaiting sign-off.</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState icon={CheckSquare} label="Nothing waiting on you right now." />
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" /> Data quality warnings
            </CardTitle>
            <CardDescription className="text-xs">Issues Gen-BI noticed in your sources.</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState icon={AlertTriangle} label="No quality issues flagged." />
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> Quick actions
            </CardTitle>
            <CardDescription className="text-xs">Common starting points.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" className="justify-start" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> New workspace
            </Button>
            <Link href="/upload">
              <Button variant="outline" size="sm" className="justify-start w-full">
                <Upload className="w-4 h-4 mr-2" /> Upload data
              </Button>
            </Link>
            <Link href="/workspaces">
              <Button variant="outline" size="sm" className="justify-start w-full">
                <Briefcase className="w-4 h-4 mr-2" /> View workspaces
              </Button>
            </Link>
            <Link href="/settings">
              <Button variant="outline" size="sm" className="justify-start w-full">
                <ArrowRight className="w-4 h-4 mr-2" /> Open settings
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
