import { useState, useEffect, useCallback, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import GeneratedDashboard from "@/components/GeneratedDashboard";
import { useRegisterObservation } from "@/lib/chat-observer";

// ── types ─────────────────────────────────────────────────────────────────────

interface PersistedChart {
  id: number;
  chartType: string;
  title: string;
  config: { xKey?: string; yKey?: string | string[]; data: any[]; sql?: string; question?: string };
  position: number;
  colSpan: number;
  hidden: boolean;
}

interface UserDashboard {
  id: number;
  name: string;
  agentLog: string | null;
  sourceDatasetIds: number[];
  rowCount: number;
  flatTableName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  charts: PersistedChart[];
  dataScience?: { rows: any[]; columns: Array<{ name: string; type: string }> };
}

// ── config builder ─────────────────────────────────────────────────────────────
// Converts the flat DB representation into a GeneratedDashboard-compatible config.

function kpiFormat(title: string): string | undefined {
  if (/revenue|sales|amount|profit|income|spend|cost|price|value|total.*(\$|usd|aud|gbp|eur)/i.test(title)) return "currency";
  if (/rate|ratio|percent|%/i.test(title)) return "percent";
  return undefined;
}

function kpiIcon(title: string): string {
  if (/revenue|sales|amount|profit|income|spend|cost|price/i.test(title)) return "DollarSign";
  if (/customer|user|owner|person|agent|member|employee|broker/i.test(title)) return "Users";
  if (/rate|ratio|percent|%/i.test(title)) return "Percent";
  if (/trend|growth|change/i.test(title)) return "TrendingUp";
  if (/record|row|count|total/i.test(title)) return "Hash";
  if (/policy|claim|risk|alert/i.test(title)) return "ShieldAlert";
  return "BarChart3";
}

function buildDashboardConfig(dashboard: UserDashboard): any {
  const sorted = [...dashboard.charts].sort((a, b) => a.position - b.position);

  const kpis = sorted
    .filter((c) => c.chartType === "kpi")
    .map((c) => {
      const data = c.config.data ?? [];
      const yKey = Array.isArray(c.config.yKey) ? c.config.yKey[0] : c.config.yKey;
      const firstRow = data[0] ?? {};
      const value = yKey ? firstRow[yKey] : firstRow[Object.keys(firstRow)[0]];
      return {
        label: c.title,
        value,
        format: kpiFormat(c.title),
        icon: kpiIcon(c.title),
      };
    });

  const charts = sorted
    .filter((c) => c.chartType !== "kpi")
    .map((c) => ({
      id: String(c.id),
      type: c.chartType,
      title: c.title,
      xKey: c.config.xKey ?? "x",
      yKey: c.config.yKey ?? "y",
      data: c.config.data ?? [],
      subtitle: c.config.question && c.config.question !== c.title ? c.config.question : undefined,
      colSpan: (c.colSpan ?? 1) as 1 | 2,
      hidden: c.hidden ?? false,
    }));

  return {
    title: dashboard.name,
    subtitle: dashboard.agentLog ?? undefined,
    kpis,
    charts,
    tables: [],
    dataScience: {
      rows: dashboard.dataScience?.rows ?? [],
      columns: dashboard.dataScience?.columns ?? [],
    },
  };
}

// ── page ───────────────────────────────────────────────────────────────────────

export default function UserDashboardPage() {
  const [, params] = useRoute("/my-dashboards/:id");
  const [, setLocation] = useLocation();
  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
  const dashId = params?.id ?? "";

  const [dashboard, setDashboard] = useState<UserDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/user-dashboards/${dashId}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setDashboard(await res.json());
    } catch (e: any) {
      setError(e.message ?? "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [apiBase, dashId]);

  useEffect(() => { load(); }, [load]);

  // Register the current dashboard as context for the chat copilot
  useRegisterObservation(
    useMemo(() => {
      if (!dashboard) return null;
      return {
        label: dashboard.name,
        kind: "dashboard" as const,
        summary:
          `Dashboard: "${dashboard.name}". ` +
          `${dashboard.charts.length} charts: ${dashboard.charts.map((c) => c.title).join(", ")}. ` +
          `${dashboard.rowCount.toLocaleString()} rows.`,
        suggestions: [
          "What's the most interesting pattern in this data?",
          "Show me a breakdown by category",
          "Which record has the highest value?",
          "Compare metrics across all groups",
        ],
      };
    }, [dashboard]),
  );

  // Persist layout changes (colSpan, hidden, ordering) back to the DB.
  const handleConfigChange = useCallback(
    async (newConfig: any) => {
      if (!dashboard) return;
      // Update UI immediately
      setDashboard((prev) => {
        if (!prev) return prev;
        const updatedCharts = prev.charts.map((c) => {
          const nc = newConfig.charts?.find((nc: any) => nc.id === String(c.id));
          if (!nc) return c;
          return { ...c, colSpan: nc.colSpan ?? c.colSpan, hidden: nc.hidden ?? c.hidden };
        });
        // Re-order based on new config order
        const newOrder = (newConfig.charts ?? []).map((nc: any) => nc.id);
        const reordered = [
          ...newOrder.map((nid: string) => updatedCharts.find((c) => String(c.id) === nid)!).filter(Boolean),
          ...updatedCharts.filter((c) => !newOrder.includes(String(c.id))),
        ];
        return { ...prev, charts: reordered.map((c, i) => ({ ...c, position: i })) };
      });

      // Batch-persist colSpan / hidden / position to DB
      const newCharts: any[] = newConfig.charts ?? [];
      await Promise.allSettled(
        newCharts.map((nc: any, i: number) =>
          fetch(`${apiBase}/api/user-dashboards/${dashId}/charts/${nc.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ colSpan: nc.colSpan ?? 1, hidden: nc.hidden ?? false, position: i }),
          }),
        ),
      );
    },
    [apiBase, dashId, dashboard],
  );

  // ── loading / error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading dashboard…</span>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <AlertCircle className="w-6 h-6 opacity-60" />
        <p className="text-sm">{error ?? "Dashboard not found"}</p>
        <Button variant="outline" size="sm" onClick={() => setLocation("/dashboards")}>
          <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back to Dashboards
        </Button>
      </div>
    );
  }

  const config = buildDashboardConfig(dashboard);

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <button
        onClick={() => setLocation("/dashboards")}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboards
      </button>

      <GeneratedDashboard config={config} onConfigChange={handleConfigChange} />
    </div>
  );
}
