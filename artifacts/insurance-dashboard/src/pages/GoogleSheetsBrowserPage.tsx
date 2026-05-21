import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import {
  FileSpreadsheet, Search, Loader2, CheckCircle2, Sparkles,
  ArrowRight, AlertCircle, Table2, Link2, BarChart3, TrendingUp, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useRegisterObservation } from "@/lib/chat-observer";

// ── types ─────────────────────────────────────────────────────────────────────

interface SheetDataset {
  id: number;
  fileName: string;
  sheetName: string;
  tableName: string;
  rowCount: number | null;
  columnSchema: { pgName: string; originalName: string; type: string; pgType: string }[] | null;
}

interface ColInfo {
  name: string;
  originalName: string;
  type: string;
  pgType: string;
}

interface PreviewData {
  columns: ColInfo[];
  rows: Record<string, unknown>[];
  rowCount: number;
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

// ── helpers ───────────────────────────────────────────────────────────────────

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

function typeLabel(t: string) {
  switch (t) {
    case "number": return "numeric";
    case "date":   return "date";
    case "boolean": return "bool";
    default:       return "text";
  }
}

// ── main component ────────────────────────────────────────────────────────────

export default function GoogleSheetsBrowserPage() {
  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [, setLocation] = useLocation();

  // parse datasetIds from URL query string
  const datasetIds = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get("datasetIds") ?? "")
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }, []);

  // sheet list
  const [sheets, setSheets] = useState<SheetDataset[]>([]);
  const [loadingSheets, setLoadingSheets] = useState(true);
  const [sheetsError, setSheetsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // selection
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // preview
  const [previewId, setPreviewId] = useState<number | null>(null);
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

  // ── load datasets on mount ────────────────────────────────────────────────

  useEffect(() => {
    if (datasetIds.length === 0) {
      setSheetsError("No dataset IDs provided. Go back and sync your sheets first.");
      setLoadingSheets(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/sheets/datasets?ids=${datasetIds.join(",")}`,
          { credentials: "include" },
        );
        if (!res.ok) {
          if (res.status === 401) { setLocation("/"); return; }
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `Server returned ${res.status}`);
        }
        const data = await res.json() as { datasets: SheetDataset[] };
        setSheets(data.datasets);
        // Auto-preview the first sheet
        if (data.datasets.length > 0) {
          loadPreview(data.datasets[0].id);
        }
        // Auto-select all
        setSelected(new Set(data.datasets.map((d) => d.id)));
      } catch (err: unknown) {
        setSheetsError(err instanceof Error ? err.message : "Could not load sheets");
      } finally {
        setLoadingSheets(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, datasetIds.join(",")]);

  // ── derived ───────────────────────────────────────────────────────────────

  const filteredSheets = useMemo(
    () =>
      sheets.filter((s) =>
        `${s.fileName} ${s.sheetName}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [sheets, search],
  );

  const previewSheet = useMemo(
    () => sheets.find((s) => s.id === previewId) ?? null,
    [sheets, previewId],
  );

  const selectedList = useMemo(() => sheets.filter((s) => selected.has(s.id)), [sheets, selected]);

  // ── chat observation ──────────────────────────────────────────────────────

  useRegisterObservation(
    useMemo(
      () => ({
        label: "Google Sheets",
        kind: "data" as const,
        summary:
          `Browsing ${sheets.length} synced Google Sheet${sheets.length !== 1 ? "s" : ""}. ` +
          (selectedList.length > 0
            ? `Selected: ${selectedList.map((s) => `${s.fileName}/${s.sheetName}`).join(", ")}. `
            : "No sheets selected yet. ") +
          (previewSheet && previewData
            ? `Previewing "${previewSheet.sheetName}" from "${previewSheet.fileName}" — columns: ${previewData.columns.map((c) => `${c.name} (${c.type})`).join(", ")}.`
            : ""),
        suggestions: [
          "What joins are possible between the selected sheets?",
          "Summarize the columns in the previewed sheet",
          "What analysis would you recommend for these sheets?",
          "How are these sheets related?",
        ],
      }),
      [sheets, selectedList, previewSheet, previewData],
    ),
  );

  // ── preview ───────────────────────────────────────────────────────────────

  const loadPreview = useCallback(
    async (id: number) => {
      if (previewId === id) return;
      setPreviewId(id);
      setPreviewData(null);
      setPreviewError(null);
      setLoadingPreview(true);
      try {
        const res = await fetch(
          `${apiBase}/api/sheets/datasets/${id}/preview`,
          { credentials: "include" },
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
    [apiBase, previewId],
  );

  // ── toggle selection ──────────────────────────────────────────────────────

  const toggleSelect = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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

    try {
      const res = await fetch(`${apiBase}/api/sheets/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          datasets: selectedList.map((s) => ({
            id: s.id,
            fileName: s.fileName,
            sheetName: s.sheetName,
            columns: (s.columnSchema ?? []).map((c) => ({
              name: c.pgName,
              type: c.type,
            })),
          })),
        }),
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
    const name =
      dashName.trim() ||
      (selectedList.length === 1
        ? selectedList[0].fileName
        : `${selectedList[0].fileName} + ${selectedList.length - 1} more`);
    setCreating(true);
    setCreateError(null);

    try {
      const res = await fetch(`${apiBase}/api/user-dashboards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ datasetIds: selectedList.map((s) => s.id), name }),
      });
      const data = await res.json() as { id?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Dashboard creation failed (${res.status})`);
      setLocation(`/my-dashboards/${data.id!}`);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Dashboard creation failed");
      setCreating(false);
    }
  }, [apiBase, selectedList, dashName, setLocation]);

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-3.5rem)] gap-0 -m-6 overflow-hidden">

      {/* ── LEFT PANEL: sheet list ─────────────────────────────────────────── */}
      <aside className="w-64 flex-shrink-0 border-r border-border bg-muted/20 flex flex-col overflow-hidden">
        {/* header */}
        <div className="p-3 border-b border-border">
          <div className="flex items-center gap-2 mb-2">
            <FileSpreadsheet className="w-4 h-4 text-green-700 flex-shrink-0" />
            <span className="text-sm font-semibold text-foreground truncate">Sheets</span>
            {!loadingSheets && (
              <Badge variant="secondary" className="ml-auto text-[10px]">{sheets.length}</Badge>
            )}
          </div>
          <div className="relative">
            <Search className="w-3 h-3 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sheets…"
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>

        {/* sheet list */}
        <div className="flex-1 overflow-y-auto">
          {loadingSheets && (
            <div className="flex items-center gap-2 p-4 text-[12px] text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading sheets…
            </div>
          )}
          {sheetsError && (
            <div className="p-3 text-[12px] text-destructive flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {sheetsError}
            </div>
          )}
          {!loadingSheets && !sheetsError && filteredSheets.length === 0 && (
            <div className="p-4 text-[12px] text-muted-foreground">
              {search ? `No sheets matching "${search}"` : "No sheets found."}
            </div>
          )}
          {!loadingSheets &&
            filteredSheets.map((sheet) => {
              const isSelected = selected.has(sheet.id);
              const isPreviewing = previewId === sheet.id;
              return (
                <div
                  key={sheet.id}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/60 transition-colors border-b border-border/40 group",
                    isPreviewing && "bg-primary/5 border-l-2 border-l-primary",
                  )}
                  onClick={() => loadPreview(sheet.id)}
                >
                  {/* checkbox */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleSelect(sheet.id); }}
                    className={cn(
                      "w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors",
                      isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-input bg-background hover:border-primary/60",
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
                    <div className="text-[11px] text-muted-foreground truncate font-mono leading-tight">
                      {sheet.fileName}
                    </div>
                    <div className="text-[12px] font-medium text-foreground truncate">{sheet.sheetName}</div>
                    {sheet.rowCount != null && (
                      <div className="text-[10px] text-muted-foreground/70">
                        {sheet.rowCount.toLocaleString()} rows
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>

        {/* action bar */}
        <div className="border-t border-border p-3 space-y-2 bg-background">
          {selected.size > 0 && (
            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-primary" />
              {selected.size} sheet{selected.size !== 1 ? "s" : ""} selected
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

        {/* recommendations */}
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
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyzing sheet relationships…
              </div>
            )}

            {recsError && (
              <div className="text-[12px] text-destructive flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {recsError}
              </div>
            )}

            {recommendations && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {recommendations.joinRecommendations.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground flex items-center gap-1.5">
                      <Link2 className="w-3 h-3" /> Join Keys
                    </h3>
                    <div className="space-y-1.5">
                      {recommendations.joinRecommendations.map((j, i) => (
                        <div key={i} className={cn("rounded-md border px-3 py-2 text-[11px]", confidenceColor(j.confidence))}>
                          <div className="font-mono font-medium">
                            {j.leftTable.split("/").pop()}.{j.leftCol}
                            <span className="mx-1.5 opacity-60">↔</span>
                            {j.rightTable.split("/").pop()}.{j.rightCol}
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

        {/* empty state */}
        {!previewId && !recommendations && (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
            <FileSpreadsheet className="w-10 h-10 opacity-20" />
            <p className="text-sm">Click a sheet on the left to preview it</p>
            <p className="text-[12px]">Check boxes to select sheets for your dashboard</p>
          </div>
        )}

        {/* data preview */}
        {previewId && (
          <section className="rounded-xl border border-border bg-card overflow-hidden">
            {/* header */}
            <div className="px-4 py-3 border-b border-border flex items-center gap-2 bg-muted/20 flex-wrap">
              <FileSpreadsheet className="w-4 h-4 text-green-700 flex-shrink-0" />
              <span className="text-sm font-semibold text-foreground font-mono">
                {previewSheet?.fileName}
                {previewSheet && <span className="text-muted-foreground font-normal"> / {previewSheet.sheetName}</span>}
              </span>
              <Badge variant="secondary" className="text-[10px]">top 20 rows</Badge>
              {previewData && (
                <div className="ml-auto flex flex-wrap gap-1.5 max-w-lg justify-end">
                  {previewData.columns.slice(0, 8).map((c) => (
                    <span
                      key={c.name}
                      className="inline-flex items-center gap-1 rounded-full bg-background border border-border px-2 py-0.5 text-[10px] font-mono text-muted-foreground"
                    >
                      {c.name}
                      <span className="opacity-50 text-[9px]">{typeLabel(c.type)}</span>
                    </span>
                  ))}
                  {previewData.columns.length > 8 && (
                    <span className="text-[10px] text-muted-foreground self-center">
                      +{previewData.columns.length - 8} more
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* body */}
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
                            <span className="font-mono text-foreground">{c.originalName || c.name}</span>
                            <span className="text-[9px] opacity-60 font-normal">{typeLabel(c.type)}</span>
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
