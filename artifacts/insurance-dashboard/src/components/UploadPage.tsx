import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { Upload, FileSpreadsheet, Loader2, AlertCircle, X, ArrowRight, Sparkles } from "lucide-react";
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

  const sourceTables: Table[] = uploadedFiles.flatMap((f) =>
    f.sheets.map((s) => ({
      id: tableIdFor(f.uploadId, s.name),
      name: tableNameFor(f.fileName, s.name, f.sheets.length > 1),
      rows: s.rows || s.sampleRows || [],
      columns: s.columns.map((c) => ({ name: c.name, type: c.type })),
      sourceFile: f.fileName,
    }))
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

      // Compute column stats over the FULL table (not the sample) so the AI sees true cardinality
      const sheetForBackend = {
        name: finalTable.name,
        rowCount: totalRows,
        columns: finalTable.columns.map((c) => ({
          name: c.name,
          type: c.type,
          uniqueCount: new Set(finalTable.rows.map((r) => String(r[c.name]))).size,
          sample: finalTable.rows.slice(0, 5).map((r) => r[c.name]),
          nullCount: finalTable.rows.filter((r) => r[c.name] === null || r[c.name] === undefined || r[c.name] === "").length,
        })),
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

  if ((stage === "prep" || stage === "generating") && sourceTables.length > 0) {
    return (
      <div className="h-[calc(100vh-3.5rem)] -m-6 flex flex-col">
        <div className="px-6 py-3 border-b border-border bg-white flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            {uploadedFiles.map((f) => (
              <div key={f.uploadId} className="group inline-flex items-center gap-1.5 px-2.5 py-1 bg-muted/40 rounded-md text-[11px]">
                <FileSpreadsheet className="w-3 h-3 text-muted-foreground" />
                <span className="font-medium">{f.fileName}</span>
                <button
                  onClick={() => removeFile(f.uploadId)}
                  className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
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
        <div className="flex-1 min-h-0 bg-muted/5">
          <DataPrep
            sourceTables={sourceTables}
            onAddMoreFiles={handleAddMoreFiles}
            onGenerateDashboard={handleGenerate}
            isGenerating={stage === "generating"}
          />
        </div>
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

        {(stage === "parsing" || stage === "generating") && (
          <div className="flex flex-col items-center gap-6 py-16 animate-in fade-in duration-500">
            <div className="relative">
              <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <p className="text-lg font-semibold text-foreground">
                {stage === "parsing" ? "Reading Your Data" : "Generating Dashboard"}
              </p>
              <p className="text-sm text-muted-foreground">{progress}</p>
            </div>
            {stage === "generating" && (
              <div className="w-64 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: "70%" }} />
              </div>
            )}
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
