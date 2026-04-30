import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import {
  Upload, FileSpreadsheet, Loader2, AlertCircle, X, ArrowRight, Sparkles,
  Database, Brain, BarChart3, Wand2, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import DataPrep from "@/components/DataPrep";
import type { Table } from "@/lib/data-operations";

interface SheetSummary {
  name: string;
  rowCount: number;
  columns: { name: string; type: string; uniqueCount: number; sample: unknown[] }[];
  sampleRows: Record<string, unknown>[];
  rows?: Record<string, unknown>[];
  truncated?: boolean;
  returnedRowCount?: number;
}

interface UploadResult {
  uploadId: string;
  fileName: string;
  sheets: SheetSummary[];
}

type Stage = "upload" | "parsing" | "prep" | "generating";

let uploadCounter = 0;
function newUploadId(): string {
  uploadCounter += 1;
  return `upload-${Date.now().toString(36)}-${uploadCounter}`;
}

function tableIdFor(uploadId: string, sheetName: string): string {
  return `${uploadId}::${sheetName}`.replace(/[^a-zA-Z0-9:_-]/g, "_");
}

function tableNameFor(fileName: string, sheetName: string, multipleSheets: boolean): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  if (!multipleSheets) return base;
  return `${base}.${sheetName}`;
}

export default function UploadPage({ onDashboardGenerated }: { onDashboardGenerated: (config: any) => { route: string } }) {
  const [stage, setStage] = useState<Stage>("upload");
  const [dragActive, setDragActive] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [loadingSamples, setLoadingSamples] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [_, setLocation] = useLocation();

  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");

  // Memoize so heavy row arrays aren't re-flatMapped on every keystroke / re-render.
  const sourceTables: Table[] = useMemo(
    () =>
      uploadedFiles.flatMap((f) =>
        f.sheets.map((s) => ({
          id: tableIdFor(f.uploadId, s.name),
          name: tableNameFor(f.fileName, s.name, f.sheets.length > 1),
          rows: s.rows || s.sampleRows || [],
          columns: s.columns.map((c) => ({ name: c.name, type: c.type })),
          sourceFile: f.fileName,
        }))
      ),
    [uploadedFiles]
  );

  const handleFile = useCallback(async (file: File) => {
    setError(null);

    // Client-side guards
    const MAX_BYTES = 60 * 1024 * 1024; // keep in sync with backend
    if (file.size > MAX_BYTES) {
      setError(`"${file.name}" is ${formatBytes(file.size)} — max upload is 60 MB.`);
      return;
    }
    const ext = file.name.toLowerCase().split(".").pop();
    if (!ext || !["csv", "xlsx", "xls"].includes(ext)) {
      setError(`Unsupported file type. Please upload CSV, XLSX, or XLS.`);
      return;
    }

    setStage("parsing");
    setProgress(`Parsing ${file.name} (${formatBytes(file.size)})...`);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${apiBase}/api/upload`, { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `Server returned ${res.status} (${res.statusText})` }));
        throw new Error(err.error || "Upload failed");
      }

      const parsed = await res.json();
      const result: UploadResult = { ...parsed, uploadId: newUploadId() };
      setUploadedFiles((prev) => [...prev, result]);
      setStage("prep");
    } catch (err: any) {
      const msg = err?.name === "TypeError"
        ? "Network error — the file may be too large or the server is unreachable."
        : (err?.message || "Failed to parse file");
      setError(msg);
      // Use functional setState pattern to avoid stale closure on uploadedFiles.length
      setUploadedFiles((prev) => {
        setStage(prev.length > 0 ? "prep" : "upload");
        return prev;
      });
    }
  }, [apiBase]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleAddMoreFiles = () => {
    fileInputRef.current?.click();
  };

  const loadSample = useCallback(async (filename: string) => {
    setError(null);
    setStage("parsing");
    setProgress(`Loading ${filename}...`);
    try {
      const samplePath = `${apiBase}/samples/${filename}`;
      const r = await fetch(samplePath);
      if (!r.ok) throw new Error(`Could not load sample: ${filename}`);
      const blob = await r.blob();
      const file = new File([blob], filename, { type: "text/csv" });
      await handleFile(file);
    } catch (err: any) {
      setError(err.message || "Failed to load sample");
      // Don't override stage here — handleFile already manages it correctly
      // based on what's in uploadedFiles after the attempted load.
    }
  }, [apiBase, handleFile]);

  const loadAllSamples = useCallback(async () => {
    if (loadingSamples) return;
    setLoadingSamples(true);
    try {
      for (const f of ["orders.csv", "customers.csv", "products.csv"]) {
        await loadSample(f);
      }
    } finally {
      setLoadingSamples(false);
    }
  }, [loadSample, loadingSamples]);

  const removeFile = (uploadId: string) => {
    setUploadedFiles((prev) => {
      const next = prev.filter((f) => f.uploadId !== uploadId);
      if (next.length === 0) setStage("upload");
      return next;
    });
  };

  const handleGenerate = async (finalTable: Table) => {
    setStage("generating");
    setProgress("AI is analyzing your data and designing visualizations...");
    setError(null);

    try {
      // Cap rows sent over the wire — AI only uses ~150 anyway, but a buffer
      // helps backend produce stratified samples. Prevents huge POST bodies
      // for large datasets (50MB CSV → could easily be hundreds of MB of JSON).
      const MAX_WIRE_ROWS = 1000;
      const totalRows = finalTable.rows.length;
      let sampledRows = finalTable.rows;
      if (totalRows > MAX_WIRE_ROWS) {
        // Stratified sample: first 200 + last 200 + evenly-spaced middle 600
        const head = finalTable.rows.slice(0, 200);
        const tail = finalTable.rows.slice(-200);
        const middle: typeof finalTable.rows = [];
        const step = Math.max(1, Math.floor((totalRows - 400) / 600));
        for (let i = 200; i < totalRows - 200 && middle.length < 600; i += step) {
          middle.push(finalTable.rows[i]);
        }
        sampledRows = [...head, ...middle, ...tail];
      }

      // Compute column stats over the FULL table in a SINGLE pass so the AI sees
      // true cardinality without freezing the UI thread on hundreds of thousands of rows.
      // Previous impl ran 3 separate full-table scans per column -> O(rows × cols × 3).
      const colStats = new Map<string, { unique: Set<string>; nullCount: number; sample: unknown[] }>();
      for (const c of finalTable.columns) {
        colStats.set(c.name, { unique: new Set<string>(), nullCount: 0, sample: [] });
      }
      for (let i = 0; i < finalTable.rows.length; i++) {
        const row = finalTable.rows[i];
        for (const c of finalTable.columns) {
          const stat = colStats.get(c.name)!;
          const v = row[c.name];
          if (v === null || v === undefined || v === "") {
            stat.nullCount++;
          } else {
            stat.unique.add(String(v));
            if (i < 5) stat.sample.push(v);
          }
        }
      }

      const sheetForBackend = {
        name: finalTable.name,
        rowCount: totalRows,
        columns: finalTable.columns.map((c) => {
          const s = colStats.get(c.name)!;
          return {
            name: c.name,
            type: c.type,
            uniqueCount: s.unique.size,
            sample: s.sample,
            nullCount: s.nullCount,
          };
        }),
        sampleRows: sampledRows.slice(0, 8),
        rows: sampledRows,
      };

      const res = await fetch(`${apiBase}/api/generate-dashboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheets: [sheetForBackend], fileName: finalTable.name }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `Server returned ${res.status}` }));
        throw new Error(err.error || "Generation failed");
      }

      const dashboardConfig = await res.json();
      const entry = onDashboardGenerated(dashboardConfig);
      setLocation(entry.route);
    } catch (err: any) {
      setError(err.message || "Failed to generate dashboard");
      setStage("prep");
    }
  };

  // Hidden file input always present for "Add File" button
  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".csv,.xlsx,.xls"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
        e.target.value = "";
      }}
    />
  );

  // Surface a friendly notice when the backend trimmed any sheet to keep the UI fast.
  const truncatedSheets = uploadedFiles.flatMap((f) =>
    f.sheets
      .filter((s) => s.truncated)
      .map((s) => ({ file: f.fileName, sheet: s.name, total: s.rowCount, returned: s.returnedRowCount ?? 0 }))
  );

  if ((stage === "prep" || stage === "generating") && sourceTables.length > 0) {
    // Keep DataPrep mounted across the prep -> generating transition so the
    // user's pipeline state survives an API failure. The cinematic loader
    // overlays the prep view instead of replacing it.
    return (
      <div className="relative h-[calc(100vh-3.5rem)] -m-6 flex flex-col">
        <div className="px-6 py-3 border-b border-border bg-white flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            {uploadedFiles.map((f) => (
              <div key={f.uploadId} className="group inline-flex items-center gap-1.5 px-2.5 py-1 bg-muted/40 rounded-md text-[11px]">
                <FileSpreadsheet className="w-3 h-3 text-muted-foreground" />
                <span className="font-medium">{f.fileName}</span>
                <button
                  onClick={() => removeFile(f.uploadId)}
                  className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                  disabled={stage === "generating"}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          {error && (
            <div className="flex items-center gap-1.5 text-destructive text-[11px]">
              <AlertCircle className="w-3.5 h-3.5" /> {error}
            </div>
          )}
        </div>
        {truncatedSheets.length > 0 && (
          <div className="px-6 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-900 flex items-start gap-2 flex-shrink-0">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-semibold">Large dataset — using a fast sample.</span>{" "}
              {truncatedSheets.map((t, i) => (
                <span key={`${t.file}::${t.sheet}`}>
                  {i > 0 && "; "}
                  <span className="font-medium">{t.file}</span> ({t.sheet}): showing {t.returned.toLocaleString()} of {t.total.toLocaleString()} rows
                </span>
              ))}
              . Stats and AI insights still use the full row counts.
            </div>
          </div>
        )}
        <div className="flex-1 min-h-0 bg-muted/5">
          <DataPrep
            sourceTables={sourceTables}
            onAddMoreFiles={handleAddMoreFiles}
            onGenerateDashboard={handleGenerate}
            isGenerating={stage === "generating"}
          />
        </div>
        {stage === "generating" && (
          <div
            className="absolute inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 backdrop-blur-sm px-4 py-10 animate-in fade-in duration-300"
            role="status"
            aria-live="polite"
          >
            <div className="w-full max-w-md">
              <GenerationLoader progress={progress} />
            </div>
          </div>
        )}
        {hiddenInput}
      </div>
    );
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-xl">
        {stage === "upload" && (
          <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center space-y-1.5">
              <h1 className="text-2xl font-bold text-foreground tracking-tight">Upload your data</h1>
              <p className="text-sm text-muted-foreground">
                Drop a CSV or Excel file to auto-generate a dashboard.
              </p>
            </div>

            {/* Primary dropzone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-xl px-6 py-12 text-center cursor-pointer transition-all duration-300",
                dragActive
                  ? "border-primary bg-primary/5 scale-[1.01]"
                  : "border-border hover:border-primary/50 hover:bg-muted/30"
              )}
            >
              <div className="flex flex-col items-center gap-3">
                <div className={cn(
                  "w-14 h-14 rounded-2xl flex items-center justify-center transition-colors",
                  dragActive ? "bg-primary/10" : "bg-muted"
                )}>
                  <Upload className={cn("w-6 h-6", dragActive ? "text-primary" : "text-muted-foreground")} />
                </div>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">
                    {dragActive ? "Drop to upload" : "Drag & drop, or click to browse"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    CSV · XLSX · XLS &nbsp;·&nbsp; up to 60 MB
                  </p>
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/20 p-3 rounded-lg">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span className="leading-snug">{error}</span>
              </div>
            )}

            {/* Subtle separator */}
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
              <div className="flex-1 h-px bg-border" />
              <span>or try a sample</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Sample data — compact one-liner */}
            <div className="flex items-center justify-between gap-3 bg-muted/30 border border-border/60 rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground">E-commerce demo</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    3 linked tables · orders, customers, products
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <SampleQuickLink name="orders.csv" disabled={loadingSamples} onLoad={() => loadSample("orders.csv")} />
                <SampleQuickLink name="customers.csv" disabled={loadingSamples} onLoad={() => loadSample("customers.csv")} />
                <SampleQuickLink name="products.csv" disabled={loadingSamples} onLoad={() => loadSample("products.csv")} />
                <Button
                  size="sm"
                  onClick={loadAllSamples}
                  disabled={loadingSamples}
                  className="text-[11px] h-7 gap-1 px-2.5"
                >
                  {loadingSamples ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /> Loading…</>
                  ) : (
                    <>Load all <ArrowRight className="w-3 h-3" /></>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {stage === "parsing" && (
          <div className="flex flex-col items-center gap-6 py-16 animate-in fade-in duration-500">
            <div className="relative">
              <div className="absolute inset-0 rounded-2xl bg-primary/20 animate-ping" />
              <div className="relative w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <p className="text-lg font-semibold text-foreground">Reading Your Data</p>
              <p className="text-sm text-muted-foreground">{progress}</p>
            </div>
          </div>
        )}

        {stage === "generating" && (
          <div className="w-full max-w-md mx-auto">
            <GenerationLoader progress={progress} />
          </div>
        )}
      </div>
      {hiddenInput}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Cinematic multi-step loader shown while the AI generates a dashboard.
 * Cycles through narrated stages and renders shimmering chart placeholders so
 * the wait feels purposeful rather than blank. Pure presentation — does not
 * gate the actual API call, which finishes whenever it finishes.
 */
function GenerationLoader({ progress }: { progress: string }) {
  const steps = useMemo(
    () => [
      { icon: Database, label: "Profiling your dataset", detail: "Detecting columns, types and outliers" },
      { icon: Brain, label: "Identifying patterns", detail: "Surfacing trends, segments and correlations" },
      { icon: BarChart3, label: "Choosing visualizations", detail: "Matching chart types to each insight" },
      { icon: Wand2, label: "Composing your dashboard", detail: "Laying out KPIs, charts and tables" },
    ],
    []
  );

  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    // Advance through narrated steps but never tick past the last one — the
    // final step stays "in progress" until the real API call finishes and the
    // page navigates away.
    const interval = setInterval(() => {
      setActiveStep((s) => (s < steps.length - 1 ? s + 1 : s));
    }, 1800);
    return () => clearInterval(interval);
  }, [steps.length]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500 py-2">
      <div className="text-center space-y-1.5">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-semibold uppercase tracking-wider">
          <Sparkles className="w-3 h-3 animate-pulse" />
          AI at work
        </div>
        <h2 className="text-xl font-bold text-foreground tracking-tight">Generating your dashboard</h2>
        <p className="text-sm text-muted-foreground">{progress || "This usually takes 10–20 seconds."}</p>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-muted-foreground uppercase tracking-wider">Pipeline</span>
            <span className="text-muted-foreground tabular-nums">
              {Math.min(activeStep + 1, steps.length)} / {steps.length}
            </span>
          </div>
        </div>
        <ul className="divide-y divide-border">
          {steps.map((step, i) => {
            const isDone = i < activeStep;
            const isActive = i === activeStep;
            const Icon = step.icon;
            return (
              <li key={step.label} className="flex items-start gap-3 px-4 py-3">
                <div
                  className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300",
                    isDone && "bg-emerald-50 text-emerald-600",
                    isActive && "bg-primary/10 text-primary",
                    !isDone && !isActive && "bg-muted text-muted-foreground/60"
                  )}
                >
                  {isDone ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : isActive ? (
                    <Icon className="w-4 h-4 animate-pulse" />
                  ) : (
                    <Icon className="w-4 h-4" />
                  )}
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <p
                    className={cn(
                      "text-sm font-medium transition-colors",
                      isDone && "text-foreground",
                      isActive && "text-foreground",
                      !isDone && !isActive && "text-muted-foreground/70"
                    )}
                  >
                    {step.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{step.detail}</p>
                </div>
                {isActive && (
                  <Loader2 className="w-3.5 h-3.5 text-primary animate-spin mt-1.5 flex-shrink-0" />
                )}
              </li>
            );
          })}
        </ul>
        <div className="h-1 bg-muted relative overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-primary transition-all duration-700 ease-out"
            style={{ width: `${((activeStep + 1) / steps.length) * 100}%` }}
          />
          <div className="absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-white/40 to-transparent shimmer-slide" />
        </div>
      </div>

      {/* Skeleton dashboard preview — hints at what's coming */}
      <div className="grid grid-cols-3 gap-2 opacity-60">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-1.5">
            <div className="h-1.5 w-12 bg-muted rounded shimmer-bg" />
            <div className="h-4 w-16 bg-muted rounded shimmer-bg" style={{ animationDelay: `${i * 100}ms` }} />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-card p-3 opacity-60">
        <div className="h-1.5 w-20 bg-muted rounded mb-2 shimmer-bg" />
        <div className="h-20 bg-muted rounded shimmer-bg" />
      </div>
    </div>
  );
}

function SampleQuickLink({
  name,
  disabled = false,
  onLoad,
}: {
  name: string;
  disabled?: boolean;
  onLoad: () => void;
}) {
  const label = name.replace(/\.csv$/i, "");
  return (
    <button
      onClick={onLoad}
      disabled={disabled}
      title={`Load ${name}`}
      className="hidden sm:inline-flex text-[11px] py-1 px-2 rounded border border-border/60 bg-white hover:border-primary/40 hover:text-primary text-muted-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );
}
