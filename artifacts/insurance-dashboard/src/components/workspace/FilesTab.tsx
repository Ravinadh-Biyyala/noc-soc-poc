import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListWorkspaceDatasets,
  useDeleteDataset,
  getListWorkspaceDatasetsQueryKey,
  getGetWorkspaceQueryKey,
  type Dataset,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  FileSpreadsheet,
  Info,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import DatasetDetailView from "./DatasetDetailView";

const MAX_BYTES = 60 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function scoreTone(score: number) {
  if (score >= 80) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (score >= 60) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-red-50 text-red-700 border-red-200";
}

interface FilesTabProps {
  workspaceId: number;
  initialDatasetId?: number;
  onSelectDataset?: (datasetId: number | null) => void;
}

export default function FilesTab({ workspaceId, initialDatasetId, onSelectDataset }: FilesTabProps) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(initialDatasetId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");

  const {
    data: datasets,
    isLoading,
    error: listError,
  } = useListWorkspaceDatasets(workspaceId, {
    query: { queryKey: getListWorkspaceDatasetsQueryKey(workspaceId) },
  });

  const deleteMutation = useDeleteDataset({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListWorkspaceDatasetsQueryKey(workspaceId) });
        await queryClient.invalidateQueries({ queryKey: getGetWorkspaceQueryKey(workspaceId) });
      },
    },
  });

  const select = (id: number | null) => {
    setSelectedId(id);
    onSelectDataset?.(id);
  };

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      const ext = file.name.toLowerCase().split(".").pop();
      if (file.size > MAX_BYTES) {
        setError(`"${file.name}" is ${formatBytes(file.size)} — max upload is 60 MB.`);
        return;
      }
      if (!ext || !["csv", "xlsx", "xls"].includes(ext)) {
        setError(`Unsupported file type. Please upload CSV, XLSX, or XLS.`);
        return;
      }

      setUploading(true);
      setProgress(`Uploading ${file.name} (${formatBytes(file.size)})…`);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(`${apiBase}/api/workspaces/${workspaceId}/datasets`, {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: `Server returned ${res.status}` }));
          throw new Error(body.error || "Upload failed");
        }
        await queryClient.invalidateQueries({ queryKey: getListWorkspaceDatasetsQueryKey(workspaceId) });
        await queryClient.invalidateQueries({ queryKey: getGetWorkspaceQueryKey(workspaceId) });
      } catch (err: any) {
        setError(err?.message || "Failed to upload file.");
      } finally {
        setUploading(false);
        setProgress("");
      }
    },
    [apiBase, queryClient, workspaceId],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) upload(file);
    },
    [upload],
  );

  if (selectedId !== null) {
    return (
      <DatasetDetailView
        workspaceId={workspaceId}
        datasetId={selectedId}
        onBack={() => select(null)}
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="files-tab">
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-xl px-6 py-10 text-center cursor-pointer transition-all",
          dragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30",
          uploading && "pointer-events-none opacity-70",
        )}
        data-testid="files-dropzone"
      >
        <div className="flex flex-col items-center gap-2">
          <div
            className={cn(
              "w-12 h-12 rounded-2xl flex items-center justify-center",
              dragActive ? "bg-primary/10" : "bg-muted",
            )}
          >
            {uploading ? (
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            ) : (
              <Upload className={cn("w-5 h-5", dragActive ? "text-primary" : "text-muted-foreground")} />
            )}
          </div>
          <p className="text-sm font-medium">
            {uploading ? progress : dragActive ? "Drop to upload" : "Drag & drop a CSV/XLSX, or click to browse"}
          </p>
          <p className="text-[11px] text-muted-foreground">CSV · XLSX · XLS · up to 60 MB</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/20 p-3 rounded-lg">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span className="leading-snug">{error}</span>
        </div>
      )}

      {(() => {
        const sampled = (datasets ?? []).filter((d) => d.truncated);
        if (sampled.length === 0) return null;
        const totalRows = sampled.reduce((s, d) => s + d.rowCount, 0);
        const sampledRows = sampled.reduce((s, d) => s + d.returnedRowCount, 0);
        return (
          <div
            className="flex items-start gap-2 text-amber-800 text-xs bg-amber-50 border border-amber-200 p-3 rounded-lg"
            data-testid="fast-sample-banner"
          >
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span className="leading-snug">
              <span className="font-semibold">Fast-sample preview:</span>{" "}
              {sampled.length === 1 ? "One file was" : `${sampled.length} files were`} parsed using a head sample of{" "}
              {sampledRows.toLocaleString()} of {totalRows.toLocaleString()} rows so the UI stays snappy. The full
              file is preserved for joins and exports.
            </span>
          </div>
        );
      })()}

      {/* Dataset list */}
      {isLoading ? (
        <div className="grid gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : listError ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">Could not load files.</CardContent>
        </Card>
      ) : (datasets?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-8 flex flex-col items-center text-center gap-2 text-muted-foreground">
            <FileSpreadsheet className="w-6 h-6 opacity-50" />
            <p className="text-sm font-medium text-foreground">No files yet</p>
            <p className="text-xs max-w-md">Upload a CSV or Excel workbook above. Each non-empty sheet becomes a dataset.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2" data-testid="files-list">
          {datasets!.map((d: Dataset) => (
            <Card
              key={d.id}
              className="cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => select(d.id)}
              data-testid={`file-row-${d.id}`}
            >
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <FileSpreadsheet className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium truncate">{d.fileName}</p>
                    <Badge variant="outline" className="text-[10px] font-normal">
                      sheet: {d.sheetName}
                    </Badge>
                    {d.truncated && (
                      <Badge variant="outline" className="text-[10px] font-normal bg-amber-50 text-amber-700 border-amber-200">
                        sampled {d.returnedRowCount.toLocaleString()} of {d.rowCount.toLocaleString()}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {d.rowCount.toLocaleString()} rows · {formatBytes(d.byteSize)} ·{" "}
                    {d.issueCount === 0 ? (
                      <span className="text-emerald-600 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> no issues
                      </span>
                    ) : (
                      <span>
                        {d.issueCount} issue{d.issueCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </p>
                </div>
                <Badge variant="outline" className={cn("text-[11px] font-semibold", scoreTone(d.readinessScore))}>
                  {d.readinessScore}%
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete ${d.fileName} (${d.sheetName})?`)) {
                      deleteMutation.mutate({ datasetId: d.id });
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  data-testid={`file-delete-${d.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
