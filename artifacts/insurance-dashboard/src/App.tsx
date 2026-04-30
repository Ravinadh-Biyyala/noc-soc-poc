import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CustomDashboardsProvider } from "@/lib/custom-dashboards";
import { CopilotProvider } from "@/lib/copilot-context";
import { TenantConfigProvider, useTenantConfig } from "@/lib/tenant-config";
import NotFound from "@/pages/not-found";
import Layout from "@/components/layout";
import DashboardSection from "@/components/DashboardSection";
import UploadPage from "@/components/UploadPage";
import UploadRedirect from "@/components/UploadRedirect";
import GeneratedDashboard from "@/components/GeneratedDashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { GeneratedDashboardProvider, useGeneratedDashboards } from "@/lib/generated-dashboards";
import Home from "@/pages/Home";
import WorkspacesList from "@/pages/WorkspacesList";
import WorkspaceDetail from "@/pages/WorkspaceDetail";
import Settings from "@/pages/Settings";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function GovernancePlaceholder() {
  return (
    <div className="max-w-3xl">
      <Card>
        <CardContent className="py-12 flex flex-col items-center text-center gap-2 text-muted-foreground">
          <ShieldCheck className="w-7 h-7 opacity-50" />
          <p className="text-sm font-medium text-foreground">Governance</p>
          <p className="text-xs max-w-md">Permissions, lineage, audit trail and approvals will live here in the Enterprise layer.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function ConfigDrivenRoutes() {
  const { config, isLoading } = useTenantConfig();
  const { dashboards, addDashboard } = useGeneratedDashboards();

  if (isLoading || !config) {
    return (
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-[400px] rounded-xl" />
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/workspaces" component={WorkspacesList} />
      <Route path="/workspaces/:id/:tab" component={WorkspaceDetail} />
      <Route path="/workspaces/:id" component={WorkspaceDetail} />
      <Route path="/settings" component={Settings} />
      <Route path="/governance" component={GovernancePlaceholder} />
      <Route path="/upload" component={UploadRedirect} />
      {/* Legacy direct-generate page kept available under /upload/legacy for parity
          with the dashboard generator until Join Studio supersedes it. */}
      <Route path="/upload/legacy" component={() => <UploadPage onDashboardGenerated={addDashboard} />} />
      {/* Legacy tenant section routes still work; they are reachable from the
          Workspace Dashboards tab once we link them in. */}
      {config.sections.map((section) => (
        <Route
          key={section.id}
          path={section.route}
          component={() => <DashboardSection sectionId={section.id} />}
        />
      ))}
      {dashboards.map((db) => (
        <Route
          key={db.id}
          path={db.route}
          component={() => <GeneratedDashboard config={db.config} />}
        />
      ))}
      <Route component={NotFound} />
    </Switch>
  );
}

function Router() {
  return (
    <Layout>
      <ConfigDrivenRoutes />
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TenantConfigProvider>
        <CopilotProvider>
          <CustomDashboardsProvider>
            <GeneratedDashboardProvider>
              <TooltipProvider>
                <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                  <Router />
                </WouterRouter>
                <Toaster />
              </TooltipProvider>
            </GeneratedDashboardProvider>
          </CustomDashboardsProvider>
        </CopilotProvider>
      </TenantConfigProvider>
    </QueryClientProvider>
  );
}

export default App;
