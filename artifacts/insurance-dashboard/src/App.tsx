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
import { Skeleton } from "@/components/ui/skeleton";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    }
  }
});

function ConfigDrivenRoutes() {
  const { config, isLoading } = useTenantConfig();

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
      {config.sections.map((section) => (
        <Route
          key={section.id}
          path={section.route}
          component={() => <DashboardSection sectionId={section.id} />}
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
            <TooltipProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <Router />
              </WouterRouter>
              <Toaster />
            </TooltipProvider>
          </CustomDashboardsProvider>
        </CopilotProvider>
      </TenantConfigProvider>
    </QueryClientProvider>
  );
}

export default App;
