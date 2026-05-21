import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useRegisterObservation } from "@/lib/chat-observer";
import { useRoute, Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetWorkspace, getGetWorkspaceQueryKey, getListWorkspacesQueryKey } from "@workspace/api-client-react";
import { getPack } from "@/lib/domain-packs";
import { WorkspaceStepper } from "@/components/WorkspaceStepper";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertTriangle, ArrowLeft, Upload, FileSpreadsheet, LayoutDashboard,
  Lightbulb, FileText, ShieldCheck, Sparkles, Loader2, Database,
  BarChart3, Trash2, Plus, AlertCircle, X, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── types ─────────────────────────────────────────────────────────────────────

interface Dataset {
  id: number;
  workspaceId: number | null;
  fileName: string;
  sheetName: string;
  tableName: string;
  rowCount: number;
  columns: { name: string; type: string }[];
  createdAt: string;
}

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

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ── WorkspaceFiles ────────────────────────────────────────────────────────────

function WorkspaceFiles({
  workspaceId,
  onFilesChanged,
}: {
  workspaceId: number;
  onFilesChanged: () => void;
}) {
  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loadingDatasets, setLoadingDatasets] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [creatingDashboard, setCreatingDashboard] = useState(false);

  const fetchDatasets = useCallback(async () => {
    setLoadingDatasets(true);
    try {
      const res = await fetch(`${apiBase}/api/datasets?workspaceId=${workspaceId}`);
      if (!res.ok) throw new Error(`${res.status}`);
      setDatasets(await res.json());
    } catch {
      setDatasets([]);
    } finally {
      setLoadingDatasets(false);
    }
  }, [apiBase, workspaceId]);

  useEffect(() => { fetchDatasets(); }, [fetchDatasets]);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    const MAX = 60 * 1024 * 1024;
    if (file.size > MAX) { setError(`"${file.name}" exceeds the 60 MB limit.`); return; }
    const ext = file.name.toLowerCase().split(".").pop();
    if (!ext || !["csv", "xlsx", "xls"].includes(ext)) {
      setError("Unsupported file type. Please upload CSV, XLSX, or XLS.");
      return;
    }

    setUploading(true);
    setUploadProgress(`Uploading ${file.name}…`);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("workspaceId", String(workspaceId));

      const res = await fetch(`${apiBase}/api/upload`, { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `Server returned ${res.status}` }));
        throw new Error(err.error || "Upload failed");
      }
      const result = await res.json();
      setUploadProgress(`Parsed ${result.sheets?.length ?? 1} sheet(s) successfully.`);
      await fetchDatasets();
      onFilesChanged();
      setTimeout(() => setUploadProgress(""), 3000);
    } catch (e: any) {
      setError(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [apiBase, workspaceId, fetchDatasets, onFilesChanged]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this dataset? This will drop the stored table.")) return;
    setDeletingId(id);
    try {
      await fetch(`${apiBase}/api/datasets/${id}`, { method: "DELETE" });
      setDatasets((prev) => prev.filter((d) => d.id !== id));
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      onFilesChanged();
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreateDashboard = async () => {
    if (selectedIds.size === 0) return;
    setCreatingDashboard(true);
    setError(null);
    try {
      const name =
        selectedIds.size === 1
          ? (datasets.find((d) => d.id === Array.from(selectedIds)[0])?.fileName?.replace(/\.[^.]+$/, "") ?? "Dashboard")
          : `${datasets.find((d) => d.id === Array.from(selectedIds)[0])?.fileName?.replace(/\.[^.]+$/, "") ?? "Dashboard"} (+${selectedIds.size - 1} more)`;

      const res = await fetch(`${apiBase}/api/user-dashboards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetIds: Array.from(selectedIds), name }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `Server returned ${res.status}` }));
        throw new Error(err.error || "Dashboard creation failed");
      }
      const dashboard = await res.json();
      onFilesChanged();
      setLocation(`/my-dashboards/${dashboard.id}`);
    } catch (e: any) {
      setError(e.message || "Failed to create dashboard");
    } finally {
      setCreatingDashboard(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-xl px-6 py-8 text-center cursor-pointer transition-all duration-200",
          uploading && "pointer-events-none opacity-60",
          dragActive
            ? "border-primary bg-primary/5 scale-[1.01]"
            : "border-border hover:border-primary/50 hover:bg-muted/20"
        )}
      >
        <div className="flex flex-col items-center gap-2">
          {uploading ? (
            <>
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">{uploadProgress}</p>
            </>
          ) : uploadProgress ? (
            <>
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              <p className="text-sm text-emerald-700">{uploadProgress}</p>
            </>
          ) : (
            <>
              <div className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                dragActive ? "bg-primary/10" : "bg-muted"
              )}>
                <Upload className={cn("w-5 h-5", dragActive ? "text-primary" : "text-muted-foreground")} />
              </div>
              <div>
                <p className="text-sm font-medium">{dragActive ? "Drop to upload" : "Drag & drop or click to upload"}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">CSV · XLSX · XLS · up to 60 MB</p>
              </div>
            </>
          )}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />

      {error && (
        <div className="flex items-start gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/20 p-3 rounded-lg">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Multi-select action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg">
          <span className="text-xs font-medium text-primary">
            {selectedIds.size} table{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="text-[11px] h-7 px-2" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
            <Button size="sm" className="text-[11px] h-7 gap-1.5 px-2.5" disabled={creatingDashboard} onClick={handleCreateDashboard}>
              {creatingDashboard
                ? <><Loader2 className="w-3 h-3 animate-spin" />Creating…</>
                : <><BarChart3 className="w-3 h-3" />Create Dashboard</>
              }
            </Button>
          </div>
        </div>
      )}

      {/* Dataset list */}
      {loadingDatasets ? (
        <div className="space-y-2">
          {[1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
      ) : datasets.length === 0 ? (
        <Card>
          <CardContent className="py-10 flex flex-col items-center gap-2 text-muted-foreground">
            <FileSpreadsheet className="w-7 h-7 opacity-40" />
            <p className="text-sm">No files uploaded to this workspace yet.</p>
            <p className="text-xs">Drop a CSV or Excel file above to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            {datasets.length} file{datasets.length !== 1 ? "s" : ""} · click to select, then "Create Dashboard"
          </p>
          {datasets.map((ds) => {
            const isSelected = selectedIds.has(ds.id);
            return (
              <div
                key={ds.id}
                onClick={() => toggleSelect(ds.id)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 border rounded-lg cursor-pointer transition-all",
                  isSelected ? "border-primary/40 bg-primary/5" : "border-border/60 bg-muted/20 hover:bg-muted/40"
                )}
              >
                {/* Checkbox */}
                <div className={cn(
                  "w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                  isSelected ? "border-primary bg-primary" : "border-border bg-background"
                )}>
                  {isSelected && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                      <path d="M2 6L5 9 10 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>

                {/* Icon */}
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Database className="w-4 h-4 text-primary" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium truncate">{ds.fileName}</span>
                    {ds.sheetName && ds.sheetName !== "Sheet1" && ds.sheetName !== ds.fileName.replace(/\.[^.]+$/, "") && (
                      <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground flex-shrink-0">
                        {ds.sheetName}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span>{ds.rowCount.toLocaleString()} rows</span>
                    <span className="text-border">·</span>
                    <span>{ds.columns.length} cols</span>
                    <span className="text-border">·</span>
                    <span>{formatRelative(ds.createdAt)}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground/70 truncate mt-0.5">
                    {ds.columns.slice(0, 6).map((c) => c.name).join(", ")}
                    {ds.columns.length > 6 && ` +${ds.columns.length - 6} more`}
                  </div>
                </div>

                {/* Delete */}
                <button
                  disabled={deletingId === ds.id}
                  onClick={(e) => { e.stopPropagation(); handleDelete(ds.id); }}
                  className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
                  title="Delete dataset"
                >
                  {deletingId === ds.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── WorkspaceDashboards ───────────────────────────────────────────────────────

function WorkspaceDashboards({ workspaceId }: { workspaceId: number }) {
  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [, setLocation] = useLocation();
  const [dashboards, setDashboards] = useState<UserDashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fetch datasets for this workspace to get their IDs
        const dsRes = await fetch(`${apiBase}/api/datasets?workspaceId=${workspaceId}`);
        const dsData: Dataset[] = dsRes.ok ? await dsRes.json() : [];
        const workspaceDsIds = new Set(dsData.map((d) => d.id));

        // Fetch all user_dashboards and filter by intersection
        const dashRes = await fetch(`${apiBase}/api/user-dashboards`);
        const allDash: UserDashboard[] = dashRes.ok ? await dashRes.json() : [];
        const filtered = allDash.filter((d) =>
          (d.sourceDatasetIds ?? []).some((id) => workspaceDsIds.has(id))
        );

        if (!cancelled) setDashboards(filtered);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, workspaceId]);

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete dashboard "${name}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await fetch(`${apiBase}/api/user-dashboards/${id}`, { method: "DELETE" });
      setDashboards((prev) => prev.filter((d) => d.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
      </div>
    );
  }

  if (dashboards.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 flex flex-col items-center gap-3 text-muted-foreground">
          <LayoutDashboard className="w-8 h-8 opacity-40" />
          <p className="text-sm font-medium text-foreground">No dashboards yet</p>
          <p className="text-xs text-center max-w-sm">
            Upload files in the Files tab, select one or more tables, then click "Create Dashboard."
          </p>
          <Button variant="outline" size="sm" onClick={() => setLocation(`/workspaces/${workspaceId}/files`)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Go to Files
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {dashboards.map((d) => (
        <Card
          key={d.id}
          className="group cursor-pointer hover:border-primary/40 hover:shadow-md transition-all"
          onClick={() => setLocation(`/my-dashboards/${d.id}`)}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <BarChart3 className="w-4.5 h-4.5 text-primary" />
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
                d.status === "ready" && "border-emerald-300 text-emerald-700 bg-emerald-50"
              )}
            >
              {d.status}
            </Badge>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(d.id, d.name); }}
                disabled={deletingId === d.id}
                className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                title="Delete"
              >
                {deletingId === d.id
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Trash2 className="w-3.5 h-3.5" />}
              </button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── placeholder ───────────────────────────────────────────────────────────────

function PlaceholderTab({ icon: Icon, title, body }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <Card>
      <CardContent className="py-12 flex flex-col items-center text-center gap-2 text-muted-foreground">
        <Icon className="w-7 h-7 opacity-50" />
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs max-w-md">{body}</p>
      </CardContent>
    </Card>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

const TABS = ["overview", "files", "prepared", "dashboards", "insights", "reports", "governance"] as const;
type TabKey = typeof TABS[number];

export default function WorkspaceDetail() {
  const [, paramsWithTab] = useRoute("/workspaces/:id/:tab");
  const [, paramsNoTab] = useRoute("/workspaces/:id");
  const params = paramsWithTab ?? paramsNoTab;
  const id = Number(params?.id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const urlTab = (paramsWithTab?.tab ?? "overview") as string;
  const tab: TabKey = (TABS as readonly string[]).includes(urlTab) ? (urlTab as TabKey) : "overview";

  useEffect(() => {
    if (paramsWithTab && !(TABS as readonly string[]).includes(urlTab)) {
      setLocation(`/workspaces/${params?.id}/overview`, { replace: true });
    }
  }, [paramsWithTab, urlTab, params?.id, setLocation]);

  const { data, isLoading, error } = useGetWorkspace(id, {
    query: { enabled: Number.isFinite(id), queryKey: getGetWorkspaceQueryKey(id) },
  });

  useRegisterObservation(
    useMemo(() => {
      if (!data) return null;
      return {
        label: `${data.name} (workspace · ${tab})`,
        kind: "workspace" as const,
        workspaceId: id,
        summary: `Workspace "${data.name}" (id=${id}, status=${data.status}). Current tab: ${tab}. ${data.fileCount ?? 0} file(s), ${data.dashboardCount ?? 0} dashboard(s), readiness ${Math.round((data.readinessScore ?? 0) * 100)}%. This is the lightweight quickstart UI — for the multi-phase agent pipeline, the user should use the Projects tab.`,
        suggestions: [
          "What's in this workspace?",
          "What should I do next here?",
          "Summarise the readiness of this workspace",
        ],
      };
    }, [data, tab, id]),
  );

  const handleTabChange = (next: string) => {
    setLocation(`/workspaces/${id}/${next}`);
  };

  const invalidateWorkspace = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetWorkspaceQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListWorkspacesQueryKey() });
  }, [queryClient, id]);

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-6xl">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-2xl">
        <Card>
          <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
            <p className="text-sm font-medium">This workspace could not be loaded.</p>
            <Link href="/workspaces">
              <Button size="sm" variant="outline">
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to workspaces
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pack = getPack(data.packId);
  const PackIcon = pack.icon;

  // Derive stepper statuses from actual workspace data
  const stepStatuses: Partial<Record<string, "done" | "active" | "queued">> = {
    upload: data.fileCount > 0 ? "done" : "active",
    understand: data.fileCount > 0 ? "done" : "queued",
    clean: data.fileCount > 0 ? "active" : "queued",
    join: data.fileCount > 1 ? "active" : "queued",
    dashboard: data.dashboardCount > 0 ? "done" : data.fileCount > 0 ? "active" : "queued",
  };

  return (
    <div className="space-y-6 max-w-6xl" data-testid="page-workspace-detail">
      {/* Header */}
      <div className="space-y-2">
        <Link href="/workspaces">
          <button className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1" data-testid="link-back">
            <ArrowLeft className="w-3 h-3" /> Workspaces
          </button>
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <PackIcon className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold tracking-tight truncate">{data.name}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">{pack.label} · {data.ownerName}</p>
              {data.description && <p className="text-xs text-muted-foreground mt-1 max-w-2xl">{data.description}</p>}
            </div>
          </div>
          <Badge variant="outline" className={cn(
            "text-[11px]",
            data.status === "active" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
            data.status === "archived" ? "bg-muted text-muted-foreground" :
            "bg-amber-50 text-amber-700 border-amber-200"
          )}>
            {data.status}
          </Badge>
        </div>
      </div>

      {/* Stepper */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <WorkspaceStepper statuses={stepStatuses as any} />
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="files" data-testid="tab-files">
            Files
            {data.fileCount > 0 && (
              <span className="ml-1.5 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                {data.fileCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="prepared" data-testid="tab-prepared">Prepared Data</TabsTrigger>
          <TabsTrigger value="dashboards" data-testid="tab-dashboards">
            Dashboards
            {data.dashboardCount > 0 && (
              <span className="ml-1.5 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                {data.dashboardCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="insights" data-testid="tab-insights">Insights</TabsTrigger>
          <TabsTrigger value="reports" data-testid="tab-reports">Reports</TabsTrigger>
          <TabsTrigger value="governance" data-testid="tab-governance">Governance</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Files</p>
                <p className="text-2xl font-bold mt-1">{data.fileCount}</p>
                {data.fileCount === 0 && (
                  <button
                    onClick={() => handleTabChange("files")}
                    className="text-[11px] text-primary mt-1 hover:underline"
                  >
                    Upload your first file →
                  </button>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Dashboards</p>
                <p className="text-2xl font-bold mt-1">{data.dashboardCount}</p>
                {data.fileCount > 0 && data.dashboardCount === 0 && (
                  <button
                    onClick={() => handleTabChange("files")}
                    className="text-[11px] text-primary mt-1 hover:underline"
                  >
                    Create your first dashboard →
                  </button>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Readiness</p>
                <p className="text-2xl font-bold mt-1">{data.readinessScore}%</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" /> Suggested by {pack.copilotName}
              </CardTitle>
              <CardDescription className="text-xs">Pack-driven prompts you can ask the Copilot.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {pack.suggestedPrompts.map((q) => (
                <Badge key={q} variant="outline" className="text-[11px] font-normal">{q}</Badge>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Starter metrics</CardTitle>
              <CardDescription className="text-xs">{pack.label} ships with these out of the box.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {pack.starterMetrics.map((m) => (
                <Badge key={m} variant="secondary" className="text-[11px]">{m}</Badge>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Files — real upload + list */}
        <TabsContent value="files" className="mt-4">
          <WorkspaceFiles workspaceId={id} onFilesChanged={invalidateWorkspace} />
        </TabsContent>

        {/* Prepared Data — flat merged tables */}
        <TabsContent value="prepared" className="mt-4">
          {data.fileCount > 0 ? (
            <WorkspaceDashboards workspaceId={id} />
          ) : (
            <PlaceholderTab
              icon={Sparkles}
              title="No prepared data yet"
              body="Upload files in the Files tab and create a dashboard — the merged flat table will appear here."
            />
          )}
        </TabsContent>

        {/* Dashboards */}
        <TabsContent value="dashboards" className="mt-4">
          <WorkspaceDashboards workspaceId={id} />
        </TabsContent>

        {/* Insights */}
        <TabsContent value="insights" className="mt-4">
          <PlaceholderTab icon={Lightbulb} title="Pinned insights appear here" body="Pin Copilot answers to keep them at hand." />
        </TabsContent>

        {/* Reports */}
        <TabsContent value="reports" className="mt-4">
          <PlaceholderTab icon={FileText} title="Reports appear here" body="Curate dashboards and insights into shareable reports." />
        </TabsContent>

        {/* Governance */}
        <TabsContent value="governance" className="mt-4">
          <PlaceholderTab icon={ShieldCheck} title="Governance" body="Permissions, lineage and audit trail for this workspace will appear here." />
        </TabsContent>
      </Tabs>
    </div>
  );
}
