import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Layout from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Claims from "@/pages/claims";
import Policies from "@/pages/policies";
import Predictive from "@/pages/predictive";
import Sentiment from "@/pages/sentiment";
import Eda from "@/pages/eda";
import Brokers from "@/pages/brokers";
import Revenue from "@/pages/revenue";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/claims" component={Claims} />
        <Route path="/policies" component={Policies} />
        <Route path="/predictive" component={Predictive} />
        <Route path="/sentiment" component={Sentiment} />
        <Route path="/eda" component={Eda} />
        <Route path="/brokers" component={Brokers} />
        <Route path="/revenue" component={Revenue} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
