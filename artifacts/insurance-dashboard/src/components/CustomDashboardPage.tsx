import { useLocation } from "wouter";
import { useCustomDashboards } from "@/lib/custom-dashboards";
import CustomChartsSection from "@/components/custom-charts-section";
import { LayoutDashboard } from "lucide-react";

export default function CustomDashboardPage() {
  const [location] = useLocation();
  const { sidebarEntries } = useCustomDashboards();

  const entry = sidebarEntries.find((e) => e.route === location);
  const title = entry?.title || "Custom Dashboard";

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <LayoutDashboard className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">{title}</h1>
          <p className="text-xs text-muted-foreground">Custom dashboard created from Copilot</p>
        </div>
      </div>

      <CustomChartsSection section={location} />

      <div className="text-center py-8 text-muted-foreground text-sm">
        <p>Ask the Copilot questions to generate charts, then pin them here.</p>
      </div>
    </div>
  );
}
