import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, FileSpreadsheet, X, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  onImported: () => void;
}

interface ImportedSheet {
  fileName: string;
  sheetName: string;
  tableName: string;
  rowCount: number;
  columnCount: number;
}

export function ProjectUploadDialog({ open, onOpenChange, projectId, onImported }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<ImportedSheet[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const reset = () => {
    setFiles([]);
    setImported([]);
    setError(null);
    setImporting(false);
  };

  const onFilesChosen = (list: FileList | null) => {
    if (!list) return;
    const arr = Array.from(list).filter((f) =>
      /\.(xlsx|xls|csv)$/i.test(f.name)
    );
    setFiles((prev) => {
      // Dedupe by name+size
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const merged = [...prev];
      for (const f of arr) {
        const k = `${f.name}:${f.size}`;
        if (!seen.has(k)) {
          seen.add(k);
          merged.push(f);
        }
      }
      return merged;
    });
  };

  const removeFile = (idx: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  const handleImport = async () => {
    if (files.length === 0) return;
    setError(null);
    setImporting(true);
    setImported([]);
    try {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      const resp = await fetch(`/api/projects/${projectId}/ingest/upload`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `Upload failed (${resp.status})`);
      }
      const data: { imported: ImportedSheet[] } = await resp.json();
      setImported(data.imported);
      // Invalidate any cached project state
      await queryClient.invalidateQueries({ queryKey: ["project-raw-tables", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["project-warehouse-status", projectId] });
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload files</DialogTitle>
          <DialogDescription>
            XLSX / XLS / CSV. Each sheet becomes a table in the project's <code className="text-xs bg-muted px-1.5 py-0.5 rounded">raw</code> schema.
            You can drop multiple files at once.
          </DialogDescription>
        </DialogHeader>

        {imported.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
              <span className="font-medium">Imported {imported.length} {imported.length === 1 ? "sheet" : "sheets"}</span>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {imported.map((row, i) => (
                <div key={i} className="text-xs flex items-center justify-between gap-2 p-2 bg-muted/40 rounded border">
                  <span className="truncate">
                    <span className="font-medium">{row.tableName}</span>
                    <span className="text-muted-foreground"> ← {row.fileName} / {row.sheetName}</span>
                  </span>
                  <span className="text-muted-foreground whitespace-nowrap">{row.rowCount.toLocaleString()} rows · {row.columnCount} cols</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onFilesChosen(e.dataTransfer.files); }}
              className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
            >
              <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">Click to choose or drop files here</p>
              <p className="text-xs text-muted-foreground mt-1">Multiple files supported · max 60 MB per file · up to 10 files</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => onFilesChosen(e.target.files)}
              />
            </div>

            {files.length > 0 && (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {files.map((f, i) => (
                  <div key={i} className="text-xs flex items-center justify-between gap-2 p-2 bg-muted/40 rounded border">
                    <span className="flex items-center gap-2 truncate">
                      <FileSpreadsheet className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="truncate">{f.name}</span>
                      <span className="text-muted-foreground whitespace-nowrap">({(f.size / 1024).toFixed(0)} KB)</span>
                    </span>
                    <button
                      onClick={() => removeFile(i)}
                      className="text-muted-foreground hover:text-foreground p-0.5"
                      disabled={importing}
                      aria-label="Remove file"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter>
          {imported.length > 0 ? (
            <Button onClick={() => { reset(); onOpenChange(false); }}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={importing}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={importing || files.length === 0} className="gap-1.5">
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Import {files.length > 0 ? `${files.length} ${files.length === 1 ? "file" : "files"}` : ""}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
