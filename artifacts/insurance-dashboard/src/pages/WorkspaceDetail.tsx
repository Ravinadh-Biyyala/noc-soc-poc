import { useEffect } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useGetWorkspace, getGetWorkspaceQueryKey } from "@workspace/api-client-react";
import { getPack } from "@/lib/domain-packs";
import { WorkspaceStepper } from "@/components/WorkspaceStepper";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertTriangle,
  ArrowLeft,
  LayoutDashboard,
  Lightbulb,
  FileText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import FilesTab from "@/components/workspace/FilesTab";

const TABS = ["overview", "files", "prepared", "dashboards", "insights", "reports", "governance"] as const;
type TabKey = (typeof TABS)[number];

function PlaceholderTab({ icon: Icon, title, body }: { icon: React.ComponentType<{ className?: string }>; title: string; body: string }) {
  return (
    <Card>
      <CardContent className="py-12 flex flex-col items-center text-center gap-2 text-muted-foreground">
        <Icon className="w-7 h-7 opacity-50" />
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs max-w-md">{body}</p>
      </CardContent>
    </Card>
  );
}

export default function WorkspaceDetail() {
  const [, paramsWithTab] = useRoute("/workspaces/:id/:tab");
  const [, paramsNoTab] = useRoute("/workspaces/:id");
  const params = paramsWithTab ?? paramsNoTab;
  const id = Number(params?.id);
  const [, setLocation] = useLocation();

  const urlTab = (paramsWithTab?.tab ?? "overview") as string;
  const tab: TabKey = (TABS as readonly string[]).includes(urlTab) ? (urlTab as TabKey) : "overview";

  // Redirect unknown tab segment back to overview so the URL stays meaningful.
  useEffect(() => {
    if (paramsWithTab && !(TABS as readonly string[]).includes(urlTab)) {
      setLocation(`/workspaces/${params?.id}/overview`, { replace: true });
    }
  }, [paramsWithTab, urlTab, params?.id, setLocation]);

  const { data, isLoading, error } = useGetWorkspace(id, {
    query: { enabled: Number.isFinite(id), queryKey: getGetWorkspaceQueryKey(id) },
  });

  const handleTabChange = (next: string) => {
    setLocation(`/workspaces/${id}/${next}`);
  };

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-6xl">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-2xl">
        <Card>
          <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
            <p className="text-sm font-medium">This workspace could not be loaded.</p>
            <Link href="/workspaces">
              <Button size="sm" variant="outline">
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to workspaces
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pack = getPack(data.packId);
  const PackIcon = pack.icon;

  return (
    <div className="space-y-6 max-w-6xl" data-testid="page-workspace-detail">
      <div className="space-y-2">
        <Link href="/workspaces">
          <button className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1" data-testid="link-back">
            <ArrowLeft className="w-3 h-3" /> Workspaces
          </button>
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <PackIcon className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold tracking-tight truncate">{data.name}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">{pack.label} · {data.ownerName}</p>
              {data.description && <p className="text-xs text-muted-foreground mt-1 max-w-2xl">{data.description}</p>}
            </div>
          </div>
          <Badge variant="outline" className={cn(
            "text-[11px]",
            data.status === "active" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
            data.status === "archived" ? "bg-muted text-muted-foreground" :
            "bg-amber-50 text-amber-700 border-amber-200"
          )}>
            {data.status}
          </Badge>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4">
          <WorkspaceStepper statuses={{ upload: data.fileCount > 0 ? "done" : "active" }} />
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="files" data-testid="tab-files">Files</TabsTrigger>
          <TabsTrigger value="prepared" data-testid="tab-prepared">Prepared Data</TabsTrigger>
          <TabsTrigger value="dashboards" data-testid="tab-dashboards">Dashboards</TabsTrigger>
          <TabsTrigger value="insights" data-testid="tab-insights">Insights</TabsTrigger>
          <TabsTrigger value="reports" data-testid="tab-reports">Reports</TabsTrigger>
          <TabsTrigger value="governance" data-testid="tab-governance">Governance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card><CardContent className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Files</p>
              <p className="text-2xl font-bold mt-1">{data.fileCount}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Dashboards</p>
              <p className="text-2xl font-bold mt-1">{data.dashboardCount}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Readiness</p>
              <p className="text-2xl font-bold mt-1">{data.readinessScore}%</p>
            </CardContent></Card>
          </div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" /> Suggested by {pack.copilotName}
              </CardTitle>
              <CardDescription className="text-xs">Pack-driven prompts you can ask the Copilot.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {pack.suggestedPrompts.map((q) => (
                <Badge key={q} variant="outline" className="text-[11px] font-normal">{q}</Badge>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Starter metrics</CardTitle>
              <CardDescription className="text-xs">{pack.label} ships with these out of the box.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {pack.starterMetrics.map((m) => (
                <Badge key={m} variant="secondary" className="text-[11px]">{m}</Badge>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          <FilesTab workspaceId={id} />
        </TabsContent>
        <TabsContent value="prepared" className="mt-4">
          <PlaceholderTab icon={Sparkles} title="Prepared data appears here" body="Joined and cleaned datasets surface on this tab once the data journey is complete." />
        </TabsContent>
        <TabsContent value="dashboards" className="mt-4">
          <PlaceholderTab icon={LayoutDashboard} title="No dashboards in this workspace" body="Generated dashboards from your uploads will be linked here. (Today they live globally on Home.)" />
        </TabsContent>
        <TabsContent value="insights" className="mt-4">
          <PlaceholderTab icon={Lightbulb} title="Pinned insights appear here" body="Pin Copilot answers to keep them at hand." />
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <PlaceholderTab icon={FileText} title="Reports appear here" body="Curate dashboards and insights into shareable reports." />
        </TabsContent>
        <TabsContent value="governance" className="mt-4">
          <PlaceholderTab icon={ShieldCheck} title="Governance" body="Permissions, lineage and audit trail for this workspace will appear here." />
        </TabsContent>
      </Tabs>
    </div>
  );
}
