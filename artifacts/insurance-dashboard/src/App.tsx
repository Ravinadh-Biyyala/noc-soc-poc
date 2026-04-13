import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CustomDashboardsProvider } from "@/lib/custom-dashboards";
import { CopilotProvider } from "@/lib/copilot-context";
import NotFound from "@/pages/not-found";
import Layout from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import SalesPerformance from "@/pages/sales";
import ProductAnalytics from "@/pages/products";
import RenewalsRetention from "@/pages/renewals";
import ClaimsRisk from "@/pages/claims";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    }
  }
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/sales" component={SalesPerformance} />
        <Route path="/products" component={ProductAnalytics} />
        <Route path="/renewals" component={RenewalsRetention} />
        <Route path="/claims" component={ClaimsRisk} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  );
}

export default App;
