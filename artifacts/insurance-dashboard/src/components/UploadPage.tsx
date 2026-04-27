import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { Upload, FileSpreadsheet, Loader2, AlertCircle, X, Plus, ArrowRight } from "lucide-react";
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
      setStage(uploadedFiles.length > 0 ? "prep" : "upload");
    }
  }, [apiBase, uploadedFiles.length]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleAddMoreFiles = () => {
    fileInputRef.current?.click();
  };

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
