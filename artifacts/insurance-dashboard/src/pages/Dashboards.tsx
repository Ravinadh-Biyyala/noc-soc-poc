import { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useRegisterObservation } from "@/lib/chat-observer";
import {
  LayoutDashboard, Sparkles, ArrowRight, Trash2,
  Loader2, BarChart3, Database,
} from "lucide-react";
import { useTenantConfig, resolveIcon } from "@/lib/tenant-config";
import { useGeneratedDashboards } from "@/lib/generated-dashboards";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── types ─────────────────────────────────────────────────────────────────────

interface UserDashboard {
  id: number;
  name: string;
  sourceDatasetIds: number[];
  rowCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function dashboardRouteFor(sectionId: string, route: string): string {
  if (route === "/" || route === "") return `/dashboards/${sectionId}`;
  return route;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ── generated dashboards section ─────────────────────────────────────────────
// Shows BOTH copilot-generated (rich config) AND data-import user dashboards
// with the same card style, since they all render as GeneratedDashboard.

function GeneratedDashboardsSection() {
  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [, setLocation] = useLocation();
  const { dashboards: copilot, removeDashboard } = useGeneratedDashboards();

  const [userDashboards, setUserDashboards] = useState<UserDashboard[]>([]);
  const [loadingUD, setLoadingUD] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${apiBase}/api/user-dashboards`)
      .then((r) => r.json())
      .then(setUserDashboards)
      .catch(() => {})
      .finally(() => setLoadingUD(false));
  }, [apiBase]);

  const handleDeleteUserDash = async (id: number, name: string) => {
    if (!confirm(`Delete dashboard "${name}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await fetch(`${apiBase}/api/user-dashboards/${id}`, { method: "DELETE" });
      setUserDashboards((prev) => prev.filter((d) => d.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  const loading = loadingUD;

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
      </div>
    );
  }

  const hasAny = userDashboards.length > 0 || copilot.length > 0;

  if (!hasAny) {
    return (
      <div className="border border-dashed border-border rounded-xl p-8 flex flex-col items-center gap-3 text-muted-foreground">
        <Sparkles className="w-7 h-7 opacity-40" />
        <p className="text-sm text-center">
          No dashboards yet. Import data from Google Sheets, upload a file, or connect a Postgres table to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {/* Data-import dashboards (Google Sheets / file upload / Postgres) */}
      {userDashboards.map((d) => (
        <Card
          key={`ud-${d.id}`}
          className="group hover:border-primary/40 hover:shadow-md transition-all cursor-pointer"
          onClick={() => setLocation(`/my-dashboards/${d.id}`)}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Database className="w-4.5 h-4.5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <CardTitle className="text-sm font-semibold truncate">{d.name}</CardTitle>
                <CardDescription className="text-[11px] mt-0.5">
                  {d.sourceDatasetIds.length} table{d.sourceDatasetIds.length !== 1 ? "s" : ""} · {d.rowCount.toLocaleString()} rows · {formatDate(d.createdAt)}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0 flex items-center justify-between">
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] uppercase tracking-wider",
                d.status === "ready" && "border-emerald-300 text-emerald-700 bg-emerald-50",
              )}
            >
              {d.status}
            </Badge>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteUserDash(d.id, d.name); }}
                disabled={deletingId === d.id}
                className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                title="Delete dashboard"
              >
                {deletingId === d.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
              </button>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Copilot-generated dashboards (rich AI config from UploadPage / chat) */}
      {copilot.map((d) => (
        <Card
          key={`cp-${d.id}`}
          className="group cursor-pointer hover:border-primary/40 hover:shadow-md transition-all"
        >
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Sparkles className="w-4.5 h-4.5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <CardTitle className="text-sm font-semibold truncate">{d.title}</CardTitle>
                <CardDescription className="text-[11px] mt-0.5">
                  Created {new Date(d.createdAt).toLocaleDateString()}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0 flex items-center justify-between">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider border-primary/30 text-primary/80 bg-primary/5">
              AI Generated
            </Badge>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${d.title}"?`)) removeDashboard(d.id);
                }}
                className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <Link href={d.route} onClick={(e) => e.stopPropagation()}>
                <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </Link>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function Dashboards() {
  const { config, isLoading } = useTenantConfig();

  useRegisterObservation(
    useMemo(() => {
      const sectionNames = (config?.sections ?? []).map((s) => s.label || s.id).join(", ");
      return {
        label: "Dashboards index",
        kind: "dashboard" as const,
        summary: `User is on the Dashboards index — the catalogue of pre-built ${config?.branding?.industry ?? "domain"} dashboards${sectionNames ? ` (${sectionNames})` : ""} plus dashboards they've generated themselves.`,
        suggestions: [
          "Which dashboard is the best starting point?",
          "Summarise what each dashboard shows",
          "Which dashboards are stale or unused?",
        ],
      };
    }, [config]),
  );

  if (isLoading || !config) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <LayoutDashboard className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Dashboards</h1>
          <p className="text-xs text-muted-foreground">
            Pre-built {config.branding?.industry || "domain"} dashboards plus anything you generate.
          </p>
        </div>
      </div>

      {/* Generated by Copilot — data-import dashboards + copilot-generated */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> Generated by Copilot
        </h2>
        <GeneratedDashboardsSection />
      </section>

      {/* Built-in dashboards */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Built-in dashboards
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {config.sections.map((section) => {
            const Icon = resolveIcon(section.icon);
            const href = dashboardRouteFor(section.id, section.route);
            const subtitle =
              section.kpis?.length
                ? `${section.kpis.length} KPIs · ${section.charts?.length || 0} charts`
                : `${section.charts?.length || 0} charts`;
            return (
              <Link key={section.id} href={href}>
                <Card
                  className="group cursor-pointer hover:border-primary/40 hover:shadow-md transition-all"
                  data-testid={`dashboard-card-${section.id}`}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Icon className="w-4.5 h-4.5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-sm font-semibold truncate">{section.label}</CardTitle>
                        <CardDescription className="text-[11px] mt-0.5">{subtitle}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 flex items-center justify-between">
                    <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
                      Built-in
                    </Badge>
                    <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
