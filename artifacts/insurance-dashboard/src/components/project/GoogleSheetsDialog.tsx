import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle, Search, LogIn } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  onImported: () => void;
}

interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
  owners?: Array<{ displayName?: string }>;
}

interface ImportResult {
  fileName: string;
  sheets: number;
}

export function ProjectGoogleSheetsDialog({ open, onOpenChange, projectId, onImported }: Props) {
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [importedResults, setImportedResults] = useState<ImportResult[] | null>(null);
  const queryClient = useQueryClient();

  const signIn = () => {
    const returnTo = encodeURIComponent(window.location.pathname);
    window.location.href = `/auth?returnTo=${returnTo}`;
  };

  const checkAuthStatus = async (): Promise<boolean> => {
    try {
      const r = await fetch("/auth/status", { credentials: "include" });
      if (!r.ok) return false;
      const data = await r.json();
      if (data?.authenticated) {
        setSignedInAs(data.email ?? null);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const loadFiles = async (q: string) => {
    setLoadingFiles(true);
    setError(null);
    try {
      const url = new URL(`/api/projects/${projectId}/ingest/google-sheets/files`, window.location.origin);
      if (q.trim()) url.searchParams.set("q", q.trim());
      const resp = await fetch(url.toString(), { credentials: "include" });
      if (resp.status === 401) { setNeedsSignIn(true); setFiles([]); return; }
      if (resp.status === 503) { setUnavailable(true); setFiles([]); return; }
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Could not list spreadsheets");
      setNeedsSignIn(false);
      setFiles(data.files ?? []);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not list spreadsheets");
    } finally {
      setLoadingFiles(false);
    }
  };

  useEffect(() => {
    if (open) {
      setImportedResults(null);
      setError(null);
      setUnavailable(false);
      setNeedsSignIn(false);
      setSelected(new Set());
      (async () => {
        const ok = await checkAuthStatus();
        if (ok) await loadFiles("");
        else setNeedsSignIn(true);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  const toggleFile = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === files.length ? new Set() : new Set(files.map((f) => f.id)),
    );
  };

  const handleImportSelected = async () => {
    if (selected.size === 0) return;
    setError(null);
    setImporting(true);

    const filesToImport = files.filter((f) => selected.has(f.id));

    const results = await Promise.allSettled(
      filesToImport.map((file) =>
        fetch(`/api/projects/${projectId}/ingest/google-sheets/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: file.id, fileName: file.name }),
          credentials: "include",
        }).then(async (resp) => {
          if (resp.status === 401) { setNeedsSignIn(true); throw new Error("Not signed in"); }
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || `Import failed for "${file.name}"`);
          return { fileName: file.name, sheets: (data.imported ?? []).length } as ImportResult;
        }),
      ),
    );

    const succeeded: ImportResult[] = [];
    const errors: string[] = [];

    for (const r of results) {
      if (r.status === "fulfilled") succeeded.push(r.value);
      else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
    }

    if (succeeded.length > 0) {
      await queryClient.invalidateQueries({ queryKey: ["project-raw-tables", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["project-warehouse-status", projectId] });
      setImportedResults(succeeded);
      onImported();
    }

    if (errors.length > 0) setError(errors.join(" · "));
    setImporting(false);
  };

  const allSelected = files.length > 0 && selected.size === files.length;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" /> Import from Google Sheets
          </DialogTitle>
          <DialogDescription>
            Pick one or more spreadsheets from your Drive. Every sheet inside each file becomes a table in the project's raw schema.
          </DialogDescription>
        </DialogHeader>

        {needsSignIn ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <LogIn className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">Sign in with Google to continue</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                We'll use your Google account to list and read spreadsheets from your Drive. Read-only — no edits.
              </p>
            </div>
            <Button onClick={signIn} className="gap-2">
              <LogIn className="w-4 h-4" /> Sign in with Google
            </Button>
          </div>
        ) : unavailable ? (
          <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Google Sheets connector unavailable</p>
              <p className="text-xs mt-1">Upload the file as XLSX instead, or sign in with Google.</p>
            </div>
          </div>
        ) : importedResults ? (
          <div className="space-y-1.5">
            {importedResults.map((r) => (
              <div key={r.fileName} className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-3">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>
                  Imported <strong>{r.sheets}</strong> {r.sheets === 1 ? "sheet" : "sheets"} from <strong>{r.fileName}</strong>.
                </span>
              </div>
            ))}
          </div>
        ) : (
          <>
            {signedInAs && (
              <p className="text-xs text-muted-foreground -mt-1">Signed in as {signedInAs}</p>
            )}

            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadFiles(query)}
                placeholder="Search Drive for a spreadsheet name…"
                className="pl-8"
              />
            </div>

            <div className="border rounded overflow-hidden">
              {/* Select-all header */}
              {files.length > 0 && (
                <div className="flex items-center gap-3 px-3 py-2 bg-muted/40 border-b text-xs text-muted-foreground">
                  <Checkbox
                    checked={allSelected}
                    data-state={someSelected ? "indeterminate" : allSelected ? "checked" : "unchecked"}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                  <span>{selected.size > 0 ? `${selected.size} of ${files.length} selected` : `${files.length} spreadsheets`}</span>
                </div>
              )}

              <div className="max-h-72 overflow-y-auto">
                {loadingFiles ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                  </div>
                ) : files.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No spreadsheets found.</p>
                ) : (
                  files.map((f) => (
                    <label
                      key={f.id}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 cursor-pointer border-b last:border-b-0"
                    >
                      <Checkbox
                        checked={selected.has(f.id)}
                        onCheckedChange={() => toggleFile(f.id)}
                        aria-label={`Select ${f.name}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{f.name}</p>
                        {f.modifiedTime && (
                          <p className="text-xs text-muted-foreground">
                            modified {new Date(f.modifiedTime).toLocaleDateString()}
                            {f.owners?.[0]?.displayName ? ` · ${f.owners[0].displayName}` : ""}
                          </p>
                        )}
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {error && (
          <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {importedResults ? "Done" : "Close"}
          </Button>
          {!importedResults && !needsSignIn && !unavailable && (
            <Button
              onClick={handleImportSelected}
              disabled={selected.size === 0 || importing}
              className="gap-1.5"
            >
              {importing ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Importing…</>
              ) : (
                <>Import {selected.size > 0 ? `${selected.size} file${selected.size > 1 ? "s" : ""}` : "selected"}</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
