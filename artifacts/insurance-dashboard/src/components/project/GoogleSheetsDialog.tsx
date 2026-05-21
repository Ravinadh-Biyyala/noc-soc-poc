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

export function ProjectGoogleSheetsDialog({ open, onOpenChange, projectId, onImported }: Props) {
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [importedFor, setImportedFor] = useState<{ fileName: string; sheets: number } | null>(null);
  const queryClient = useQueryClient();

  const signIn = () => {
    // /auth is proxied by Vite to the backend, which redirects to Google's
    // consent screen. After consent Google redirects back to /auth/callback
    // (per REDIRECT_URI in .env), the backend writes userId to the session,
    // and the user is redirected to /?google_connected=1.
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
      if (resp.status === 401) {
        setNeedsSignIn(true);
        setFiles([]);
        return;
      }
      if (resp.status === 503) {
        setUnavailable(true);
        setFiles([]);
        return;
      }
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Could not list spreadsheets");
      setNeedsSignIn(false);
      setFiles(data.files ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not list spreadsheets");
    } finally {
      setLoadingFiles(false);
    }
  };

  useEffect(() => {
    if (open) {
      setImportedFor(null);
      setError(null);
      setUnavailable(false);
      setNeedsSignIn(false);
      (async () => {
        const ok = await checkAuthStatus();
        if (ok) await loadFiles("");
        else setNeedsSignIn(true);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  const handleImport = async (file: DriveFile) => {
    setError(null);
    setImporting(file.id);
    try {
      const resp = await fetch(`/api/projects/${projectId}/ingest/google-sheets/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: file.id, fileName: file.name }),
        credentials: "include",
      });
      if (resp.status === 401) {
        setNeedsSignIn(true);
        return;
      }
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `Import failed (${resp.status})`);
      setImportedFor({ fileName: file.name, sheets: (data.imported ?? []).length });
      await queryClient.invalidateQueries({ queryKey: ["project-raw-tables", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["project-warehouse-status", projectId] });
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" /> Import from Google Sheets
          </DialogTitle>
          <DialogDescription>
            Pick a spreadsheet from your Drive. Every sheet inside it becomes a table in the project's raw schema.
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
                We'll use your Google account to list and read spreadsheets from your Drive.
                Read-only — no edits.
              </p>
            </div>
            <Button onClick={signIn} className="gap-2">
              <LogIn className="w-4 h-4" />
              Sign in with Google
            </Button>
          </div>
        ) : unavailable ? (
          <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Google Sheets connector unavailable</p>
              <p className="text-xs mt-1">
                Upload the file as XLSX instead, or sign in with Google.
              </p>
            </div>
          </div>
        ) : importedFor ? (
          <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-3">
            <CheckCircle2 className="w-4 h-4" />
            <span>
              Imported {importedFor.sheets} {importedFor.sheets === 1 ? "sheet" : "sheets"} from <strong>{importedFor.fileName}</strong>.
            </span>
          </div>
        ) : (
          <>
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

            <div className="space-y-1.5 max-h-80 overflow-y-auto border rounded p-1">
              {loadingFiles ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
              ) : files.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No spreadsheets found.</p>
              ) : (
                files.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-2 p-2 hover:bg-muted/50 rounded text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{f.name}</p>
                      {f.modifiedTime && (
                        <p className="text-xs text-muted-foreground">
                          modified {new Date(f.modifiedTime).toLocaleDateString()}
                          {f.owners?.[0]?.displayName ? ` · ${f.owners[0].displayName}` : ""}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleImport(f)}
                      disabled={importing !== null}
                      className="gap-1.5"
                    >
                      {importing === f.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      Import
                    </Button>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {error && (
          <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{importedFor ? "Done" : "Close"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
