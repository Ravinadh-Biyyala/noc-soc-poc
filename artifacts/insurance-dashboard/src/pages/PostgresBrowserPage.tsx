import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import {
  Database, Search, Loader2, CheckCircle2, Sparkles,
  ArrowRight, ChevronRight, AlertCircle, Table2, Link2,
  BarChart3, TrendingUp, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useRegisterObservation } from "@/lib/chat-observer";

// ── types ────────────────────────────────────────────────────────────────────

interface PgTable {
  schema: string;
  table: string;
}

interface ColInfo {
  name: string;
  type: string;
}

interface PreviewData {
  columns: ColInfo[];
  rows: Record<string, unknown>[];
}

interface JoinRec {
  leftTable: string;
  leftCol: string;
  rightTable: string;
  rightCol: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

interface AnalysisIdea {
  title: string;
  question: string;
  chartType: string;
}

interface Recommendations {
  joinRecommendations: JoinRec[];
  analysisIdeas: AnalysisIdea[];
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return v.toLocaleDateString();
  const s = String(v);
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}

function confidenceColor(c: string) {
  if (c === "high") return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (c === "medium") return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-slate-600 bg-slate-50 border-slate-200";
}

const CHART_ICONS: Record<string, React.ReactNode> = {
  bar: <BarChart3 className="w-3.5 h-3.5" />,
  line: <TrendingUp className="w-3.5 h-3.5" />,
  pie: <span className="text-[11px]">◑</span>,
  scatter: <span className="text-[11px]">⊡</span>,
  kpi: <span className="text-[11px] font-bold">KPI</span>,
  table: <Table2 className="w-3.5 h-3.5" />,
};

// ── main component ────────────────────────────────────────────────────────────

export default function PostgresBrowserPage() {
  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [, setLocation] = useLocation();

  // tables list
  const [tables, setTables] = useState<PgTable[]>([]);
  const [loadingTables, setLoadingTables] = useState(true);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // table selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // preview
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // recommendations
  const [recommendations, setRecommendations] = useState<Recommendations | null>(null);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [recsError, setRecsError] = useState<string | null>(null);

  // dashboard creation
  const [dashName, setDashName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ── load tables on mount ──────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/postgres/tables`, { credentials: "include" });
        if (!res.ok) {
          if (res.status === 401) {
            setLocation("/");
            return;
          }
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `Server returned ${res.status}`);
        }
        const data = await res.json() as { tables: PgTable[] };
        setTables(data.tables);
      } catch (err: unknown) {
        setTablesError(err instanceof Error ? err.message : "Could not load tables");
      } finally {
        setLoadingTables(false);
      }
    })();
  }, [apiBase, setLocation]);

  // ── derived ───────────────────────────────────────────────────────────────

  const filteredTables = useMemo(
    () =>
      tables.filter(
        (t) =>
          `${t.schema}.${t.table}`.toLowerCase().includes(search.toLowerCase())
      ),
    [tables, search]
  );

  const selectedList = useMemo(
    () =>
      [...selected]
        .map((k) => {
          const [schema, table] = k.split(".");
          return { schema, table };
        })
        .filter((t) => t.schema && t.table),
    [selected]
  );

  const previewTable = useMemo(() => {
    if (!previewKey) return null;
    const [schema, table] = previewKey.split(".");
    return { schema, table };
  }, [previewKey]);

  // ── chat observation (sync) ───────────────────────────────────────────────

  const dbName = useMemo(() => {
    const url = new URLSearchParams(window.location.search);
    return url.get("db") ?? "Postgres";
  }, []);

  useRegisterObservation(
    useMemo(
      () => ({
        label: `Postgres: ${dbName}`,
        kind: "data" as const,
        summary:
          `Browsing Postgres database. ${tables.length} tables available. ` +
          (selectedList.length > 0
            ? `Selected: ${selectedList.map((t) => `${t.schema}.${t.table}`).join(", ")}. `
            : "No tables selected yet. ") +
          (previewTable && previewData
            ? `Previewing ${previewTable.schema}.${previewTable.table} — columns: ${previewData.columns.map((c) => `${c.name} (${c.type})`).join(", ")}.`
            : ""),
        suggestions: [
          "What joins are possible between the selected tables?",
          "Summarize the columns in the previewed table",
          "What analysis would you recommend for these tables?",
          "How are these tables related?",
        ],
      }),
      [dbName, tables.length, selectedList, previewTable, previewData]
    )
  );

  // ── preview ───────────────────────────────────────────────────────────────

  const loadPreview = useCallback(
    async (schema: string, table: string) => {
      const key = `${schema}.${table}`;
      if (previewKey === key) return;
      setPreviewKey(key);
      setPreviewData(null);
      setPreviewError(null);
      setLoadingPreview(true);
      try {
        const res = await fetch(
          `${apiBase}/api/postgres/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/preview`,
          { credentials: "include" }
        );
        const body = await res.json() as PreviewData & { error?: string };
        if (!res.ok) throw new Error(body.error ?? `Server returned ${res.status}`);
        setPreviewData(body);
      } catch (err: unknown) {
        setPreviewError(err instanceof Error ? err.message : "Preview failed");
      } finally {
        setLoadingPreview(false);
      }
    },
    [apiBase, previewKey]
  );

  // ── toggle selection ──────────────────────────────────────────────────────

  const toggleSelect = useCallback((schema: string, table: string) => {
    const key = `${schema}.${table}`;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setRecommendations(null);
    setRecsError(null);
  }, []);

  // ── AI recommendations ────────────────────────────────────────────────────

  const getRecommendations = useCallback(async () => {
    if (selectedList.length === 0) return;
    setLoadingRecs(true);
    setRecsError(null);
    setRecommendations(null);

    // Fetch column info for each selected table
    const tablesWithCols: { schema: string; table: string; columns: ColInfo[] }[] = [];
    for (const { schema, table } of selectedList) {
      try {
        const res = await fetch(
          `${apiBase}/api/postgres/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/preview`,
          { credentials: "include" }
        );
        const data = await res.json() as PreviewData;
        tablesWithCols.push({ schema, table, columns: data.columns });
      } catch {
        tablesWithCols.push({ schema, table, columns: [] });
      }
    }

    try {
      const res = await fetch(`${apiBase}/api/postgres/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tables: tablesWithCols }),
      });
      const data = await res.json() as Recommendations & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Server returned ${res.status}`);
      setRecommendations(data);
    } catch (err: unknown) {
      setRecsError(err instanceof Error ? err.message : "Recommendations failed");
    } finally {
      setLoadingRecs(false);
    }
  }, [apiBase, selectedList]);

  // ── create dashboard ──────────────────────────────────────────────────────

  const handleCreateDashboard = useCallback(async () => {
    if (selectedList.length === 0) return;
    const name = dashName.trim() || `${selectedList.map((t) => t.table).join(" + ")} Dashboard`;
    setCreating(true);
    setCreateError(null);

    try {
      // 1. Import selected tables
      const importRes = await fetch(`${apiBase}/api/postgres/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tables: selectedList }),
      });
      const importData = await importRes.json() as { datasetIds?: number[]; error?: string };
      if (!importRes.ok) throw new Error(importData.error ?? `Import failed (${importRes.status})`);
      const datasetIds = importData.datasetIds ?? [];

      if (datasetIds.length === 0) {
        throw new Error("No datasets were imported. Check that the selected tables exist and have data.");
      }

      // 2. Create user dashboard (AI merge + charts)
      const dashRes = await fetch(`${apiBase}/api/user-dashboards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ datasetIds, name }),
      });
      const dashData = await dashRes.json() as { id?: number; error?: string };
      if (!dashRes.ok) throw new Error(dashData.error ?? `Dashboard creation failed (${dashRes.status})`);

      const dashId = dashData.id!;

      // Navigate to the new dashboard (stored in user_dashboards table)
      setLocation(`/my-dashboards/${dashId}`);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Dashboard creation failed");
      setCreating(false);
    }
  }, [apiBase, selectedList, dashName, setLocation]);

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-3.5rem)] gap-0 -m-6 overflow-hidden">
      {/* ── LEFT PANEL: table list ─────────────────────────────────────────── */}
      <aside className="w-64 flex-shrink-0 border-r border-border bg-muted/20 flex flex-col overflow-hidden">
        {/* header */}
        <div className="p-3 border-b border-border">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="text-sm font-semibold text-foreground truncate">Tables</span>
            {!loadingTables && (
              <Badge variant="secondary" className="ml-auto text-[10px]">{tables.length}</Badge>
            )}
          </div>
          <div className="relative">
            <Search className="w-3 h-3 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tables…"
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>

        {/* table list */}
        <div className="flex-1 overflow-y-auto">
          {loadingTables && (
            <div className="flex items-center gap-2 p-4 text-[12px] text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading tables…
            </div>
          )}
          {tablesError && (
            <div className="p-3 text-[12px] text-destructive flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {tablesError}
            </div>
          )}
          {!loadingTables && !tablesError && filteredTables.length === 0 && (
            <div className="p-4 text-[12px] text-muted-foreground">
              {search ? `No tables matching "${search}"` : "No tables found."}
            </div>
          )}
          {!loadingTables &&
            filteredTables.map(({ schema, table }) => {
              const key = `${schema}.${table}`;
              const isSelected = selected.has(key);
              const isPreviewing = previewKey === key;
              return (
                <div
                  key={key}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/60 transition-colors border-b border-border/40 group",
                    isPreviewing && "bg-primary/5 border-l-2 border-l-primary"
                  )}
                  onClick={() => loadPreview(schema, table)}
                >
                  {/* checkbox */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleSelect(schema, table); }}
                    className={cn(
                      "w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors",
                      isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-input bg-background hover:border-primary/60"
                    )}
                    title={isSelected ? "Deselect" : "Select for dashboard"}
                  >
                    {isSelected && (
                      <svg viewBox="0 0 10 8" className="w-2.5 h-2 fill-current">
                        <path d="M1 4l2.5 2.5L9 1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                      </svg>
                    )}
                  </button>
                  {/* name */}
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-mono text-muted-foreground truncate">{schema}</div>
                    <div className="text-[12px] font-medium text-foreground truncate">{table}</div>
                  </div>
                  <ChevronRight className={cn("w-3 h-3 text-muted-foreground/50 flex-shrink-0 group-hover:text-muted-foreground transition-colors", isPreviewing && "text-primary")} />
                </div>
              );
            })}
        </div>

        {/* selection action bar */}
        <div className="border-t border-border p-3 space-y-2 bg-background">
          {selected.size > 0 && (
            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-primary" />
              {selected.size} table{selected.size !== 1 ? "s" : ""} selected
              <button
                onClick={() => { setSelected(new Set()); setRecommendations(null); }}
                className="ml-auto text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="w-full text-[11px] h-7"
            disabled={selected.size < 1 || loadingRecs}
            onClick={getRecommendations}
          >
            {loadingRecs ? (
              <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Analyzing…</>
            ) : (
              <><Sparkles className="w-3 h-3 mr-1.5" />AI Recommendations</>
            )}
          </Button>

          <div className="space-y-1.5">
            <Input
              value={dashName}
              onChange={(e) => setDashName(e.target.value)}
              placeholder="Dashboard name (optional)"
              className="h-7 text-xs"
            />
            <Button
              size="sm"
              className="w-full text-[11px] h-7"
              disabled={selected.size === 0 || creating}
              onClick={handleCreateDashboard}
            >
              {creating ? (
                <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Creating (~20s)…</>
              ) : (
                <>Create Dashboard <ArrowRight className="w-3 h-3 ml-1.5" /></>
              )}
            </Button>
          </div>

          {createError && (
            <div className="text-[11px] text-destructive flex items-start gap-1">
              <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" /> {createError}
            </div>
          )}
        </div>
      </aside>

      {/* ── MAIN PANEL: preview + recommendations ──────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* recommendations panel */}
        {(recommendations || loadingRecs || recsError) && (
          <section className="rounded-xl border border-border bg-card p-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold">AI Analysis Recommendations</h2>
              {recommendations && (
                <button onClick={() => setRecommendations(null)} className="ml-auto text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {loadingRecs && (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyzing table relationships…
              </div>
            )}

            {recsError && (
              <div className="text-[12px] text-destructive flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {recsError}
              </div>
            )}

            {recommendations && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* join recommendations */}
                {recommendations.joinRecommendations.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground flex items-center gap-1.5">
                      <Link2 className="w-3 h-3" /> Join Keys
                    </h3>
                    <div className="space-y-1.5">
                      {recommendations.joinRecommendations.map((j, i) => (
                        <div key={i} className={cn("rounded-md border px-3 py-2 text-[11px]", confidenceColor(j.confidence))}>
                          <div className="font-mono font-medium">
                            {j.leftTable.split(".").pop()}.{j.leftCol}
                            <span className="mx-1.5 opacity-60">↔</span>
                            {j.rightTable.split(".").pop()}.{j.rightCol}
                          </div>
                          <div className="mt-0.5 opacity-80">{j.reason}</div>
                          <Badge variant="outline" className={cn("mt-1 text-[9px] uppercase", confidenceColor(j.confidence))}>
                            {j.confidence} confidence
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* analysis ideas */}
                {recommendations.analysisIdeas.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground flex items-center gap-1.5">
                      <BarChart3 className="w-3 h-3" /> Analysis Ideas
                    </h3>
                    <div className="space-y-1.5">
                      {recommendations.analysisIdeas.map((idea, i) => (
                        <div key={i} className="rounded-md border border-border bg-muted/20 px-3 py-2 text-[11px]">
                          <div className="flex items-center gap-1.5 font-medium text-foreground">
                            <span className="text-primary">{CHART_ICONS[idea.chartType] ?? <BarChart3 className="w-3.5 h-3.5" />}</span>
                            {idea.title}
                          </div>
                          <div className="text-muted-foreground mt-0.5">{idea.question}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* data preview */}
        {!previewKey && !recommendations && (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
            <Table2 className="w-10 h-10 opacity-20" />
            <p className="text-sm">Click a table on the left to preview it</p>
            <p className="text-[12px]">Check boxes to select tables for your dashboard</p>
          </div>
        )}

        {previewKey && (
          <section className="rounded-xl border border-border bg-card overflow-hidden">
            {/* preview header */}
            <div className="px-4 py-3 border-b border-border flex items-center gap-2 bg-muted/20">
              <Table2 className="w-4 h-4 text-primary flex-shrink-0" />
              <span className="text-sm font-semibold text-foreground font-mono">{previewKey}</span>
              <Badge variant="secondary" className="text-[10px]">top 20 rows</Badge>
              {previewData && (
                <div className="ml-auto flex flex-wrap gap-1.5 max-w-md justify-end">
                  {previewData.columns.slice(0, 8).map((c) => (
                    <span key={c.name} className="inline-flex items-center gap-1 rounded-full bg-background border border-border px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                      {c.name}
                      <span className="opacity-50 text-[9px]">{c.type.replace("character varying", "varchar")}</span>
                    </span>
                  ))}
                  {previewData.columns.length > 8 && (
                    <span className="text-[10px] text-muted-foreground">+{previewData.columns.length - 8} more</span>
                  )}
                </div>
              )}
            </div>

            {/* preview body */}
            {loadingPreview && (
              <div className="flex items-center gap-2 p-6 text-[12px] text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading preview…
              </div>
            )}
            {previewError && (
              <div className="flex items-start gap-2 p-4 text-[12px] text-destructive">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {previewError}
              </div>
            )}
            {previewData && !loadingPreview && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-muted/40">
                    <tr>
                      {previewData.columns.map((c) => (
                        <th
                          key={c.name}
                          className="text-left px-3 py-2 font-medium text-muted-foreground border-b border-border whitespace-nowrap"
                        >
                          <div className="flex flex-col">
                            <span className="font-mono text-foreground">{c.name}</span>
                            <span className="text-[9px] opacity-60 font-normal">{c.type.replace("character varying", "varchar")}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.rows.map((row, ri) => (
                      <tr key={ri} className={ri % 2 === 0 ? "bg-background" : "bg-muted/10"}>
                        {previewData.columns.map((c) => (
                          <td
                            key={c.name}
                            className="px-3 py-1.5 border-b border-border/30 whitespace-nowrap text-foreground/80"
                          >
                            {fmt(row[c.name])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
