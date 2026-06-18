import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LokiPinsProvider } from "@/lib/loki-pins";
import { ChatObserverProvider } from "@/lib/chat-observer";
import { NocUiProvider } from "@/lib/ui-bridge";
import { CopilotKit } from "@copilotkit/react-core";
import Layout from "@/components/layout";
import LokiDashboard from "@/pages/LokiDashboard";
import LokiAssets from "@/pages/LokiAssets";
import LokiTraces from "@/pages/LokiTraces";
import LokiLogs from "@/pages/LokiLogs";
import LokiPins from "@/pages/LokiPins";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// The shell is a single feature now: Loki Logs. "/" redirects there; everything
// else is a 404.
function RedirectToDashboard() {
  const [, setLocation] = useLocation();
  useEffect(() => setLocation("/dashboard"), [setLocation]);
  return null;
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={RedirectToDashboard} />
      <Route path="/dashboard" component={LokiDashboard} />
      <Route path="/assets" component={LokiAssets} />
      <Route path="/loki-traces" component={LokiTraces} />
      <Route path="/loki-logs" component={LokiLogs} />
      <Route path="/loki-pins" component={LokiPins} />
      <Route component={NotFound} />
    </Switch>
  );
}

function Router() {
  // NocUiProvider sits inside the WouterRouter (the drawer deep-links via
  // useLocation) and wraps both the pages and the right-rail chat, so the agent
  // can open the deep-diagnosis drawer from anywhere.
  return (
    <NocUiProvider>
      <Layout>
        <AppRoutes />
      </Layout>
    </NocUiProvider>
  );
}

/**
 * Wraps the app in the CopilotKit (AG-UI) provider for the right-rail BI
 * Companion. Must sit inside ChatObserverProvider so the chat can read the
 * current page observation.
 */
function CopilotKitBridge({ children }: { children: React.ReactNode }) {
  const runtimeUrl = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/copilotkit`;
  return (
    <CopilotKit
      runtimeUrl={runtimeUrl}
      credentials="include"
      showDevConsole={false}
      enableInspector={false}
    >
      {children}
    </CopilotKit>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LokiPinsProvider>
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
      </LokiPinsProvider>
    </QueryClientProvider>
  );
}

export default App;
