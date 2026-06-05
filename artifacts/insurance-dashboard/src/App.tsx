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
import GeneratedDashboard from "@/components/GeneratedDashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { GeneratedDashboardProvider, useGeneratedDashboards } from "@/lib/generated-dashboards";
import { ChatObserverProvider, useChatObserver } from "@/lib/chat-observer";
import { CopilotKit } from "@copilotkit/react-core";
import Home from "@/pages/Home";
import Projects from "@/pages/Projects";
import ProjectDetail from "@/pages/ProjectDetail";
import Settings from "@/pages/Settings";
import Dashboards from "@/pages/Dashboards";
import UserDashboardPage from "@/pages/UserDashboardPage";
import PostgresBrowserPage from "@/pages/PostgresBrowserPage";
import GoogleSheetsBrowserPage from "@/pages/GoogleSheetsBrowserPage";
import VisualsCatalog from "@/pages/VisualsCatalog";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { useRegisterObservation } from "@/lib/chat-observer";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function GovernancePlaceholder() {
  useRegisterObservation(
    useMemo(
      () => ({
        label: "Governance (placeholder)",
        kind: "other" as const,
        summary: "User is on the Governance placeholder. The Enterprise layer (permissions, lineage, audit trail, approvals) is not yet implemented — nothing to query here.",
        suggestions: [
          "What is Governance going to do?",
          "How does this differ from project-level permissions?",
        ],
      }),
      [],
    ),
  );

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
  const { dashboards, addDashboard, updateDashboardConfig } = useGeneratedDashboards();

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
      <Route path="/projects" component={Projects} />
      {/* Deep-link to a specific project dashboard so the Copilot's openDashboard
          action (and shareable URLs) can open one directly. */}
      <Route path="/projects/:id/dashboards/:dashId" component={ProjectDetail} />
      <Route path="/projects/:id/:tab" component={ProjectDetail} />
      <Route path="/projects/:id" component={ProjectDetail} />
      <Route path="/settings" component={Settings} />
      <Route path="/governance" component={GovernancePlaceholder} />
      <Route path="/dashboards" component={Dashboards} />
      <Route path="/my-dashboards/:id" component={UserDashboardPage} />
      <Route path="/postgres-browser" component={PostgresBrowserPage} />
      <Route path="/google-sheets-browser" component={GoogleSheetsBrowserPage} />
      <Route path="/visuals-catalog" component={VisualsCatalog} />
      {/* Every tenant section is also reachable under /dashboards/:id so the
          executive section (whose legacy route is "/") doesn't collide with
          Home. The legacy routes still work for any non-root paths. */}
      {config.sections.map((section) => (
        <Route
          key={`dash-${section.id}`}
          path={`/dashboards/${section.id}`}
          component={() => <DashboardSection sectionId={section.id} />}
        />
      ))}
      {config.sections
        .filter((s) => s.route && s.route !== "/")
        .map((section) => (
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
          component={() => (
            <GeneratedDashboard
              config={db.config}
              onConfigChange={(next) => updateDashboardConfig(db.id, next)}
            />
          )}
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

/**
 * Wraps the app in the CopilotKit (AG-UI) provider. Reads the active project
 * from the chat-observer so the runtime receives the current workspaceId as a
 * request property — the server scopes the dataset-query tool and instructions
 * to that project. Must sit inside ChatObserverProvider.
 */
function CopilotKitBridge({ children }: { children: React.ReactNode }) {
  const { observation } = useChatObserver();
  const runtimeUrl = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/copilotkit`;
  return (
    <CopilotKit
      runtimeUrl={runtimeUrl}
      credentials="include"
      showDevConsole={false}
      // Hide CopilotKit's floating dev Inspector (AG-UI events / threads panel).
      // It's a developer debugging overlay — not part of the protocol — and
      // defaults to enabled; users shouldn't see it.
      enableInspector={false}
      properties={{ workspaceId: observation.workspaceId ?? null }}
    >
      {children}
    </CopilotKit>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TenantConfigProvider>
        <CopilotProvider>
          <CustomDashboardsProvider>
            <GeneratedDashboardProvider>
              <ChatObserverProvider>
                <CopilotKitBridge>
                  <TooltipProvider>
                    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                      <Router />
                    </WouterRouter>
                    <Toaster />
                  </TooltipProvider>
                </CopilotKitBridge>
              </ChatObserverProvider>
            </GeneratedDashboardProvider>
          </CustomDashboardsProvider>
        </CopilotProvider>
      </TenantConfigProvider>
    </QueryClientProvider>
  );
}

export default App;
