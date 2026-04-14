import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { Upload, FileSpreadsheet, Loader2, CheckCircle, AlertCircle, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SheetSummary {
  name: string;
  rowCount: number;
  columns: { name: string; type: string; uniqueCount: number; sample: unknown[] }[];
  sampleRows: Record<string, unknown>[];
}

interface UploadResult {
  fileName: string;
  sheets: SheetSummary[];
}

type Stage = "upload" | "parsing" | "preview" | "generating" | "done";

export default function UploadPage({ onDashboardGenerated }: { onDashboardGenerated: (config: any) => { route: string } }) {
  const [stage, setStage] = useState<Stage>("upload");
  const [dragActive, setDragActive] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [selectedSheets, setSelectedSheets] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [_, setLocation] = useLocation();

  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setStage("parsing");
    setProgress("Parsing your data...");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${apiBase}/api/upload`, { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }

      const result: UploadResult = await res.json();
      setUploadResult(result);
      setSelectedSheets(new Set(result.sheets.map((s) => s.name)));
      setStage("preview");
    } catch (err: any) {
      setError(err.message || "Failed to parse file");
      setStage("upload");
    }
  }, [apiBase]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleGenerate = async () => {
    if (!uploadResult) return;
    setStage("generating");
    setProgress("AI is analyzing your data and designing visualizations...");

    try {
      const sheetsToSend = uploadResult.sheets.filter((s) => selectedSheets.has(s.name));
      const res = await fetch(`${apiBase}/api/generate-dashboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheets: sheetsToSend, fileName: uploadResult.fileName }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Generation failed");
      }

      const dashboardConfig = await res.json();
      setStage("done");
      const entry = onDashboardGenerated(dashboardConfig);
      setLocation(entry.route);
    } catch (err: any) {
      setError(err.message || "Failed to generate dashboard");
      setStage("preview");
    }
  };

  const toggleSheet = (name: string) => {
    setSelectedSheets((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {stage === "upload" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold text-foreground tracking-tight">Upload Your Data</h1>
              <p className="text-sm text-muted-foreground">
                Drop a CSV or Excel file and we'll generate a beautiful dashboard automatically
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
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
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

        {stage === "preview" && uploadResult && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-foreground">{uploadResult.fileName}</h2>
                <p className="text-xs text-muted-foreground">
                  {uploadResult.sheets.length} sheet{uploadResult.sheets.length > 1 ? "s" : ""} detected
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setStage("upload"); setUploadResult(null); }}>
                <X className="w-4 h-4 mr-1" /> Change File
              </Button>
            </div>

            <div className="space-y-3">
              {uploadResult.sheets.map((sheet) => (
                <Card
                  key={sheet.name}
                  className={cn(
                    "cursor-pointer transition-all border-2",
                    selectedSheets.has(sheet.name)
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-transparent hover:border-border"
                  )}
                  onClick={() => toggleSheet(sheet.name)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-lg flex items-center justify-center",
                          selectedSheets.has(sheet.name) ? "bg-primary/10" : "bg-muted"
                        )}>
                          {selectedSheets.has(sheet.name) ? (
                            <CheckCircle className="w-5 h-5 text-primary" />
                          ) : (
                            <FileSpreadsheet className="w-5 h-5 text-muted-foreground" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{sheet.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {sheet.rowCount.toLocaleString()} rows · {sheet.columns.length} columns
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {sheet.columns.slice(0, 8).map((col) => (
                        <span
                          key={col.name}
                          className={cn(
                            "text-[10px] px-2 py-0.5 rounded-full",
                            col.type === "number" ? "bg-blue-50 text-blue-700" :
                            col.type === "date" ? "bg-amber-50 text-amber-700" :
                            "bg-gray-100 text-gray-600"
                          )}
                        >
                          {col.name}
                        </span>
                      ))}
                      {sheet.columns.length > 8 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                          +{sheet.columns.length - 8} more
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 p-3 rounded-lg">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <Button
              size="lg"
              className="w-full gap-2"
              disabled={selectedSheets.size === 0}
              onClick={handleGenerate}
            >
              Generate Dashboard <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
