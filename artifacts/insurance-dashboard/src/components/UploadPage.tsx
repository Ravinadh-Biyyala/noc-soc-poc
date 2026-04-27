import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { Upload, FileSpreadsheet, Loader2, AlertCircle, X, Plus, ArrowRight, Download, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
    setStage("parsing");
    setProgress(`Parsing ${file.name}...`);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${apiBase}/api/upload`, { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }

      const parsed = await res.json();
      const result: UploadResult = { ...parsed, uploadId: newUploadId() };
      setUploadedFiles((prev) => [...prev, result]);
      setStage("prep");
    } catch (err: any) {
      setError(err.message || "Failed to parse file");
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
      const sheetForBackend = {
        name: finalTable.name,
        rowCount: finalTable.rows.length,
        columns: finalTable.columns.map((c) => ({
          name: c.name,
          type: c.type,
          uniqueCount: new Set(finalTable.rows.map((r) => String(r[c.name]))).size,
          sample: finalTable.rows.slice(0, 5).map((r) => r[c.name]),
          nullCount: finalTable.rows.filter((r) => r[c.name] === null || r[c.name] === undefined || r[c.name] === "").length,
        })),
        sampleRows: finalTable.rows.slice(0, 8),
        rows: finalTable.rows,
      };

      const res = await fetch(`${apiBase}/api/generate-dashboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheets: [sheetForBackend], fileName: finalTable.name }),
      });

      if (!res.ok) {
        const err = await res.json();
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
      <div className="w-full max-w-2xl">
        {stage === "upload" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground tracking-tight">Upload Your Data</h1>
              <p className="text-sm text-muted-foreground">
                Drop CSV or Excel files. Combine multiple files with joins, filters, and aggregations — then auto-generate a dashboard.
              </p>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-xl p-16 text-center cursor-pointer transition-all duration-300",
                dragActive
                  ? "border-primary bg-primary/5 scale-[1.02]"
                  : "border-border hover:border-primary/50 hover:bg-muted/30"
              )}
            >
              <div className="flex flex-col items-center gap-4">
                <div className={cn(
                  "w-16 h-16 rounded-2xl flex items-center justify-center transition-colors",
                  dragActive ? "bg-primary/10" : "bg-muted"
                )}>
                  <Upload className={cn("w-7 h-7", dragActive ? "text-primary" : "text-muted-foreground")} />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {dragActive ? "Drop your file here" : "Drag & drop your file here"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">or click to browse — CSV, XLSX, XLS supported</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-2">
              <FeatureCard icon="🔗" title="Multi-file Joins" description="Combine related datasets" />
              <FeatureCard icon="🎯" title="Filters & Aggregates" description="Shape your data" />
              <FeatureCard icon="✨" title="AI Dashboards" description="Auto-generated visuals" />
            </div>

            {/* Sample data section */}
            <div className="border border-border/60 rounded-xl p-4 bg-gradient-to-br from-blue-50/40 to-purple-50/40">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-white border border-border/50 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-foreground">No data handy? Try the sample dataset</h3>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={loadAllSamples}
                      disabled={loadingSamples}
                      className="text-xs h-7 gap-1.5 flex-shrink-0"
                    >
                      {loadingSamples ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> Loading...</>
                      ) : (
                        <><Sparkles className="w-3 h-3" /> Load all 3</>
                      )}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-3">
                    A small e-commerce dataset designed to demonstrate joins. Orders link to customers and products.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <SampleFileChip name="orders.csv" desc="20 transactions" disabled={loadingSamples} onLoad={() => loadSample("orders.csv")} />
                    <SampleFileChip name="customers.csv" desc="5 customers" disabled={loadingSamples} onLoad={() => loadSample("customers.csv")} />
                    <SampleFileChip name="products.csv" desc="4 products" disabled={loadingSamples} onLoad={() => loadSample("products.csv")} />
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 p-3 rounded-lg">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}
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

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <Card className="border-border/60 hover:border-primary/30 transition-colors">
      <CardContent className="p-3 text-center space-y-1">
        <div className="text-xl">{icon}</div>
        <div className="text-[11px] font-semibold text-foreground">{title}</div>
        <div className="text-[10px] text-muted-foreground">{description}</div>
      </CardContent>
    </Card>
  );
}

function SampleFileChip({
  name,
  desc,
  disabled = false,
  onLoad,
}: {
  name: string;
  desc: string;
  disabled?: boolean;
  onLoad: () => void;
}) {
  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <div className="group bg-white border border-border/60 rounded-md p-2 hover:border-primary/40 transition-colors">
      <div className="flex items-center gap-1.5 mb-1.5">
        <FileSpreadsheet className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] font-semibold text-foreground truncate flex-1">{name}</span>
      </div>
      <div className="text-[9px] text-muted-foreground mb-2">{desc}</div>
      <div className="flex gap-1">
        <button
          onClick={onLoad}
          disabled={disabled}
          className="flex-1 text-[10px] py-1 px-1.5 rounded bg-primary/10 hover:bg-primary/20 text-primary font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Load
        </button>
        <a
          href={`${apiBase}/samples/${name}`}
          download={name}
          className="px-1.5 py-1 rounded border border-border/60 hover:border-primary/40 hover:text-primary transition-colors"
          title={`Download ${name}`}
          aria-label={`Download ${name}`}
        >
          <Download className="w-2.5 h-2.5" />
        </a>
      </div>
    </div>
  );
}
