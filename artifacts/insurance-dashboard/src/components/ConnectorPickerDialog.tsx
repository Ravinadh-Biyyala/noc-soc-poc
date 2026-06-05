import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, CheckCircle2, Database, Loader2, ShieldCheck, ArrowRight, Search, FileSpreadsheet, LogIn } from "lucide-react";
import { CONNECTORS, type ConnectorConfig, type ConnectorField } from "@/lib/connectors.config";
import { cn } from "@/lib/utils";

interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
}

interface SheetTab {
  sheetId: number;
  title: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If set, pre-select Google Sheets when dialog opens */
  autoOpenGoogleSheets?: boolean;
}

export function ConnectorPickerDialog({ open, onOpenChange, autoOpenGoogleSheets }: Props) {
  const [active, setActive] = useState<ConnectorConfig | null>(null);
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [, setLocation] = useLocation();

  // Auto-select Google Sheets if requested (e.g. after OAuth callback redirect)
  useEffect(() => {
    if (open && autoOpenGoogleSheets) {
      const gsheets = CONNECTORS.find((c) => c.id === "google-sheets");
      if (gsheets) setActive(gsheets);
    }
  }, [open, autoOpenGoogleSheets]);

  // Reset whenever the dialog reopens or the active connector changes.
  useEffect(() => {
    if (!open) {
      setActive(null);
      setValues({});
    }
  }, [open]);

  useEffect(() => {
    setValues({});
  }, [active?.id]);

  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");

  const renderField = (field: ConnectorField) => {
    const v = values[field.key];
    const set = (next: string | string[]) => setValues((prev) => ({ ...prev, [field.key]: next }));

    if (field.type === "select") {
      return (
        <Select value={(v as string) || ""} onValueChange={set}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder={field.placeholder || "Select…"} />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (field.type === "multiselect") {
      const selected = (Array.isArray(v) ? v : []) as string[];
      const toggle = (opt: string) => {
        const next = selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt];
        set(next);
      };
      return (
        <div className="flex flex-wrap gap-1.5">
          {(field.options ?? []).map((o) => {
            const isSel = selected.includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => toggle(o)}
                className={
                  "px-2.5 py-1 rounded-full border text-[11px] transition-colors " +
                  (isSel
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-input text-muted-foreground hover:bg-muted")
                }
              >
                {o}
              </button>
            );
          })}
        </div>
      );
    }
    if (field.type === "textarea") {
      return (
        <Textarea
          value={(v as string) || ""}
          placeholder={field.placeholder}
          rows={3}
          onChange={(e) => set(e.target.value)}
          className="text-xs font-mono"
        />
      );
    }
    return (
      <Input
        type={field.type === "password" ? "password" : "text"}
        value={(v as string) || ""}
        placeholder={field.placeholder}
        onChange={(e) => set(e.target.value)}
        className="h-9 text-sm"
      />
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {!active ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Database className="w-4 h-4 text-primary" /> Connect a data source
              </DialogTitle>
              <DialogDescription>
                Pick a source. Add credentials and choose what to pull —
                Gen-BI does the rest.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
              {CONNECTORS.map((c) => {
                const Icon = c.icon;
                return (
                  <button
                    key={c.id}
                    onClick={() => setActive(c)}
                    className="text-left rounded-lg border border-border bg-card hover:border-primary hover:shadow-sm transition-all p-3 group"
                    data-testid={`connector-card-${c.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-md border flex items-center justify-center flex-shrink-0 ${c.accent}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                          {c.label}
                          <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
                          {c.description}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="w-3.5 h-3.5" />
              Demo mode — connections return curated sample data. Live OAuth + drivers wire in per-customer.
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActive(null)}
                  className="p-1 -ml-1 rounded hover:bg-muted"
                  aria-label="Back"
                >
                  <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                </button>
                <div className={`w-8 h-8 rounded-md border flex items-center justify-center ${active.accent}`}>
                  <active.icon className="w-4 h-4" />
                </div>
                <DialogTitle>Connect to {active.label}</DialogTitle>
              </div>
              <DialogDescription>{active.description}</DialogDescription>
            </DialogHeader>

            {active.live && active.id === "google-sheets" ? (
              <GoogleSheetsPicker
                apiBase={apiBase}
                onClose={() => onOpenChange(false)}
                onSynced={(datasetIds) => {
                  onOpenChange(false);
                  setLocation(`/google-sheets-browser?datasetIds=${datasetIds.join(",")}`);
                }}
              />
            ) : active.live && active.id === "postgres" ? (
              <PostgresPicker
                apiBase={apiBase}
                onClose={() => onOpenChange(false)}
                onConnected={() => {
                  onOpenChange(false);
                  setLocation("/postgres-browser");
                }}
              />
            ) : (
              <div className="space-y-3 mt-1">
                {active.fields.map((f) => (
                  <div key={f.key} className="space-y-1.5">
                    <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {f.label}
                      {f.required && <span className="text-destructive ml-1">*</span>}
                    </Label>
                    {renderField(f)}
                  </div>
                ))}
                <p className="text-[12px] text-muted-foreground pt-1">
                  Live connection coming soon.
                </p>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface PickerProps {
  apiBase: string;
  onSynced: (datasetIds: number[]) => void;
  onClose: () => void;
}

type PickerPhase =
  | "checking"
  | "unauthenticated"
  | "listing"
  | "configure"
  | "syncing";

interface SyncResultWithPreview {
  datasetId: number;
  table: string;
  rowCount: number;
  columns: { name: string; originalName: string; type: string }[];
  sampleRows: string[][];
  columnNames: string[];
  fileName: string;
  sheetName: string;
}

function GoogleSheetsPicker({ apiBase, onSynced, onClose }: PickerProps) {
  const [phase, setPhase] = useState<PickerPhase>("checking");
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Multi-select state
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [fileTabsMap, setFileTabsMap] = useState<Map<string, SheetTab[]>>(new Map());
  const [fileTabsLoading, setFileTabsLoading] = useState<Set<string>>(new Set());
  const [selectedTabsMap, setSelectedTabsMap] = useState<Map<string, string>>(new Map());

  const [syncError, setSyncError] = useState<string | null>(null);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiBase}/auth/status`, { credentials: "include" });
        if (!aliveRef.current) return;
        const data = await res.json() as { authenticated: boolean; email?: string };
        if (data.authenticated && data.email) {
          setAuthEmail(data.email);
          setPhase("listing");
          loadFiles("");
        } else {
          setPhase("unauthenticated");
        }
      } catch {
        if (aliveRef.current) setPhase("unauthenticated");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadFiles = async (q: string) => {
    setLoadingFiles(true);
    setError(null);
    try {
      const url = `${apiBase}/api/sheets${q ? `?q=${encodeURIComponent(q)}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!aliveRef.current) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Listing failed (HTTP ${res.status})`);
      }
      const data = await res.json() as { files: DriveFile[] };
      if (!aliveRef.current) return;
      setFiles(data.files);
    } catch (err: unknown) {
      if (!aliveRef.current) return;
      setError(err instanceof Error ? err.message : "Could not list files");
    } finally {
      if (aliveRef.current) setLoadingFiles(false);
    }
  };

  const fetchTabsForFile = async (file: DriveFile) => {
    setFileTabsLoading((prev) => new Set([...prev, file.id]));
    try {
      const res = await fetch(`${apiBase}/api/sheets/${encodeURIComponent(file.id)}/tabs`, {
        credentials: "include",
      });
      if (!aliveRef.current) return;
      if (!res.ok) return;
      const data = await res.json() as { tabs: SheetTab[] };
      if (!aliveRef.current) return;
      setFileTabsMap((prev) => new Map([...prev, [file.id, data.tabs]]));
      setSelectedTabsMap((prev) => {
        if (prev.has(file.id) || data.tabs.length === 0) return prev;
        return new Map([...prev, [file.id, data.tabs[0].title]]);
      });
    } finally {
      if (aliveRef.current) {
        setFileTabsLoading((prev) => { const n = new Set(prev); n.delete(file.id); return n; });
      }
    }
  };

  const toggleFile = (file: DriveFile) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(file.id)) {
        next.delete(file.id);
      } else {
        next.add(file.id);
        if (!fileTabsMap.has(file.id) && !fileTabsLoading.has(file.id)) {
          fetchTabsForFile(file);
        }
      }
      return next;
    });
  };

  const handleBatchSync = async () => {
    setPhase("syncing");
    setSyncError(null);
    const sheetsToSync = Array.from(selectedFileIds).map((fileId) => ({
      spreadsheetId: fileId,
      sheetName: selectedTabsMap.get(fileId) ?? "",
    })).filter((s) => s.sheetName);

    try {
      const res = await fetch(`${apiBase}/api/sync/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sheets: sheetsToSync }),
      });
      if (!aliveRef.current) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Sync failed (HTTP ${res.status})`);
      }
      const data = await res.json() as { results: SyncResultWithPreview[] };
      if (!aliveRef.current) return;
      onSynced(data.results.map((r) => r.datasetId));
    } catch (err: unknown) {
      if (!aliveRef.current) return;
      setSyncError(err instanceof Error ? err.message : "Sync failed");
      setPhase("configure");
    }
  };

  // ── Phase: checking ──────────────────────────────────────────────────────────

  if (phase === "checking") {
    return (
      <div className="mt-4 flex items-center gap-2 text-[13px] text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Checking Google connection…
      </div>
    );
  }

  // ── Phase: unauthenticated ───────────────────────────────────────────────────

  if (phase === "unauthenticated") {
    return (
      <div className="mt-1">
        <div className="rounded-md border border-border bg-muted/20 p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-md bg-white border border-border flex items-center justify-center">
              <FileSpreadsheet className="w-4 h-4 text-green-700" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground leading-tight">
                Connect your Google account
              </div>
              <div className="text-[11px] text-muted-foreground leading-tight">
                Sign in to import your Google Sheets into Gen-BI
              </div>
            </div>
          </div>
          <Button onClick={() => { window.location.href = "/auth"; }} className="w-full" size="sm">
            <LogIn className="w-4 h-4 mr-2" />
            Sign in with Google
          </Button>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-4 pt-3 border-t border-border">
            <ShieldCheck className="w-3.5 h-3.5" />
            Read-only OAuth scope. Gen-BI never modifies your sheets.
          </div>
        </div>
      </div>
    );
  }

  // ── Phase: listing (multi-select) ────────────────────────────────────────────

  if (phase === "listing") {
    const selectedCount = selectedFileIds.size;
    return (
      <div className="mt-1 space-y-3 animate-in fade-in duration-300">
        {authEmail && (
          <div className="text-[11px] text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
            Connected as <span className="font-medium text-foreground">{authEmail}</span>
          </div>
        )}

        <form
          className="relative"
          onSubmit={(e) => { e.preventDefault(); loadFiles(query.trim()); }}
        >
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your Google Sheets…"
            className="h-9 pl-8 text-sm"
          />
        </form>

        <div className="rounded-md border border-border max-h-[320px] overflow-y-auto">
          {loadingFiles && (
            <div className="flex items-center gap-2 p-4 text-[12px] text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading your spreadsheets…
            </div>
          )}
          {!loadingFiles && files.length === 0 && !error && (
            <div className="p-4 text-[12px] text-muted-foreground">
              No spreadsheets found{query ? ` matching "${query}"` : ""}.
            </div>
          )}
          {!loadingFiles && files.length > 0 && (
            <ul className="divide-y divide-border">
              {files.map((f) => {
                const isSelected = selectedFileIds.has(f.id);
                const when = f.modifiedTime
                  ? new Date(f.modifiedTime).toLocaleDateString(undefined, {
                      year: "numeric", month: "short", day: "numeric",
                    })
                  : "";
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => toggleFile(f)}
                      className={cn(
                        "w-full text-left flex items-center gap-3 px-3 py-2.5 transition-colors",
                        isSelected
                          ? "bg-primary/5 hover:bg-primary/10"
                          : "hover:bg-muted/60",
                      )}
                    >
                      <input
                        type="checkbox"
                        readOnly
                        checked={isSelected}
                        className="w-3.5 h-3.5 rounded accent-primary flex-shrink-0"
                        tabIndex={-1}
                      />
                      <FileSpreadsheet className="w-4 h-4 text-green-700 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-foreground truncate">{f.name}</div>
                        {when && <div className="text-[11px] text-muted-foreground">{when}</div>}
                      </div>
                      {fileTabsLoading.has(f.id) && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground flex-shrink-0" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && <div className="text-[12px] text-destructive">{error}</div>}

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="w-3.5 h-3.5" />
            {selectedCount > 0
              ? `${selectedCount} file${selectedCount > 1 ? "s" : ""} selected`
              : "Select one or more files"}
          </div>
          <Button
            onClick={() => setPhase("configure")}
            disabled={selectedCount === 0}
            size="sm"
          >
            Configure tabs <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        </div>
      </div>
    );
  }

  // ── Phase: configure (pick a tab per file) ───────────────────────────────────

  if (phase === "configure") {
    const selectedFiles = files.filter((f) => selectedFileIds.has(f.id));
    const anyLoading = selectedFiles.some((f) => fileTabsLoading.has(f.id));
    const allTabsReady = selectedFiles.every(
      (f) => !fileTabsLoading.has(f.id) && (fileTabsMap.get(f.id)?.length ?? 0) > 0,
    );

    return (
      <div className="mt-1 space-y-4 animate-in fade-in duration-300">
        <button
          onClick={() => setPhase("listing")}
          className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to file list
        </button>

        <div className="space-y-3">
          {selectedFiles.map((f) => {
            const tabs = fileTabsMap.get(f.id) ?? [];
            const isLoadingTabs = fileTabsLoading.has(f.id);
            const selectedTab = selectedTabsMap.get(f.id) ?? "";

            return (
              <div key={f.id} className="rounded-md border border-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-green-700 flex-shrink-0" />
                  <span className="text-sm font-medium text-foreground truncate flex-1">{f.name}</span>
                  {isLoadingTabs && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                </div>

                {!isLoadingTabs && tabs.length === 0 && (
                  <div className="text-[11px] text-muted-foreground">No tabs found</div>
                )}
                {!isLoadingTabs && tabs.length > 0 && (
                  <Select
                    value={selectedTab}
                    onValueChange={(v) =>
                      setSelectedTabsMap((prev) => new Map([...prev, [f.id, v]]))
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select a tab…" />
                    </SelectTrigger>
                    <SelectContent>
                      {tabs.map((t) => (
                        <SelectItem key={t.sheetId} value={t.title ?? ""}>
                          {t.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            );
          })}
        </div>

        {syncError && <div className="text-[12px] text-destructive">{syncError}</div>}

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <div className="text-[11px] text-muted-foreground">
            {anyLoading ? "Loading tabs…" : `${selectedFiles.length} sheet${selectedFiles.length > 1 ? "s" : ""} ready to sync`}
          </div>
          <Button
            onClick={handleBatchSync}
            disabled={anyLoading || !allTabsReady}
            size="sm"
          >
            Sync &amp; Browse <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        </div>
      </div>
    );
  }

  // ── Phase: syncing ───────────────────────────────────────────────────────────

  if (phase === "syncing") {
    const selectedFiles = files.filter((f) => selectedFileIds.has(f.id));
    return (
      <div className="mt-4">
        <div className="rounded-md border border-border bg-muted/20 p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-md bg-white border border-border flex items-center justify-center">
              <FileSpreadsheet className="w-4 h-4 text-green-700" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground leading-tight">
                Syncing {selectedFiles.length} sheet{selectedFiles.length > 1 ? "s" : ""}…
              </div>
              <div className="text-[11px] text-muted-foreground leading-tight">
                Importing rows and creating database tables
              </div>
            </div>
          </div>
          <ul className="space-y-2.5">
            <ConnectStep label="Fetching rows from Google Sheets" state="done" />
            <ConnectStep label="Creating database tables" state="active" />
            <ConnectStep label="Inserting data" state="pending" />
          </ul>
        </div>
      </div>
    );
  }

  return null;
}

// ── PostgresPicker ─────────────────────────────────────────────────────────────

interface PostgresPickerProps {
  apiBase: string;
  onConnected: () => void;
  onClose: () => void;
}

type PgPhase = "idle" | "connecting" | "connected";

function PostgresPicker({ apiBase, onConnected }: PostgresPickerProps) {
  const [phase, setPhase] = useState<PgPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dbName, setDbName] = useState("");
  const [tableCount, setTableCount] = useState(0);

  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("5432");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("postgres");
  const [password, setPassword] = useState("");
  const [ssl, setSsl] = useState("disable");

  const handleConnect = async () => {
    if (!host.trim() || !database.trim() || !username.trim()) {
      setError("Host, database, and username are required.");
      return;
    }
    setPhase("connecting");
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/postgres/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ host: host.trim(), port: parseInt(port) || 5432, database: database.trim(), username: username.trim(), password, ssl }),
      });
      const data = await res.json() as { ok?: boolean; database?: string; tableCount?: number; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Server returned ${res.status}`);
      }
      setDbName(data.database ?? database);
      setTableCount(data.tableCount ?? 0);
      setPhase("connected");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setPhase("idle");
    }
  };

  if (phase === "connecting") {
    return (
      <div className="mt-4 flex items-center gap-2 text-[13px] text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Connecting to Postgres…
      </div>
    );
  }

  if (phase === "connected") {
    return (
      <div className="mt-1 space-y-4 animate-in fade-in duration-300">
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3.5">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 flex-shrink-0" />
            <div>
              <div className="text-sm font-semibold text-emerald-900">Connected to <span className="font-mono">{dbName}</span></div>
              <div className="text-[12px] text-emerald-800 mt-0.5">
                Found <span className="font-medium">{tableCount}</span> table{tableCount !== 1 ? "s" : ""} ready to browse.
              </div>
            </div>
          </div>
        </div>
        <Button onClick={onConnected} className="w-full" size="sm">
          Browse Tables <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-1 space-y-3 animate-in fade-in duration-300">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Host <span className="text-destructive">*</span></Label>
          <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" className="h-9 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Port</Label>
          <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="5432" className="h-9 text-sm" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Database <span className="text-destructive">*</span></Label>
        <Input value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="mydb" className="h-9 text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Username <span className="text-destructive">*</span></Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="postgres" className="h-9 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Password</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="h-9 text-sm" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">SSL mode</Label>
        <Select value={ssl} onValueChange={setSsl}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="disable">Disable</SelectItem>
            <SelectItem value="prefer">Prefer</SelectItem>
            <SelectItem value="require">Require</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && <div className="text-[12px] text-destructive">{error}</div>}

      <div className="flex items-center justify-between pt-2 border-t border-border">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5" />
          Credentials stay in your session only.
        </div>
        <Button
          onClick={handleConnect}
          disabled={!host.trim() || !database.trim() || !username.trim()}
          size="sm"
        >
          Connect <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
        </Button>
      </div>
    </div>
  );
}

// ── ConnectStep ────────────────────────────────────────────────────────────────

function ConnectStep({
  label,
  state,
}: {
  label: string;
  state: "pending" | "active" | "done";
}) {
  return (
    <li className="flex items-center gap-2.5 text-[12.5px]">
      <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
        {state === "done" && <CheckCircle2 className="w-4 h-4 text-green-600" />}
        {state === "active" && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
        {state === "pending" && <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />}
      </span>
      <span
        className={cn(
          "transition-colors",
          state === "done" && "text-foreground",
          state === "active" && "text-foreground font-medium",
          state === "pending" && "text-muted-foreground/70",
        )}
      >
        {label}
      </span>
    </li>
  );
}
