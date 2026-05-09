import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, CheckCircle2, Database, Loader2, ShieldCheck, Sparkles, ArrowRight, Search, FileSpreadsheet } from "lucide-react";
import { CONNECTORS, type ConnectorConfig, type ConnectorField } from "@/lib/connectors.config";
import { setPendingFile } from "@/lib/pending-file";

interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
  owners?: { displayName?: string }[];
}

type Stage = "idle" | "testing" | "tested" | "pulling";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectorPickerDialog({ open, onOpenChange }: Props) {
  const [active, setActive] = useState<ConnectorConfig | null>(null);
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [, setLocation] = useLocation();

  // Reset whenever the dialog reopens or the active connector changes.
  useEffect(() => {
    if (!open) {
      setActive(null);
      setValues({});
      setStage("idle");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    setValues({});
    setStage("idle");
    setError(null);
  }, [active?.id]);

  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");

  const missingRequired = active
    ? active.fields.filter((f) => {
        if (!f.required) return false;
        const v = values[f.key];
        if (Array.isArray(v)) return v.length === 0;
        return !v || !String(v).trim();
      })
    : [];

  const handleTest = async () => {
    if (!active) return;
    if (missingRequired.length > 0) {
      setError(`Please fill required fields: ${missingRequired.map((f) => f.label).join(", ")}`);
      return;
    }
    // Capture the connector at the start so a late completion (e.g. user
    // switched connectors or closed the dialog) cannot push a stale "tested"
    // state onto a different connector.
    const startedFor = active.id;
    setStage("testing");
    setError(null);
    await new Promise((r) => setTimeout(r, 900));
    setActive((current) => {
      if (current && current.id === startedFor) {
        setStage("tested");
      }
      return current;
    });
  };

  const handlePull = async () => {
    if (!active) return;
    setStage("pulling");
    setError(null);
    try {
      const res = await fetch(`${apiBase}/samples/${active.sampleFile}`);
      if (!res.ok) throw new Error(`Could not fetch sample data (HTTP ${res.status})`);
      const blob = await res.blob();
      // Name the file after the connector dataset so the rest of the app
      // displays "Snowflake — ANALYTICS.PUBLIC.CUSTOMERS.csv" rather than
      // a raw "customers.csv" filename.
      const safeLabel = active.sampleLabel.replace(/[^\w. -]/g, "_");
      const file = new File([blob], `${safeLabel}.csv`, { type: "text/csv" });
      setPendingFile(file);
      onOpenChange(false);
      setLocation("/upload");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Pull failed";
      setError(msg);
      setStage("tested");
    }
  };

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
                onPicked={(file) => {
                  setPendingFile(file);
                  onOpenChange(false);
                  setLocation("/upload");
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
              </div>
            )}

            {stage === "tested" && (
              <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900">
                <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 flex-shrink-0" />
                <div>
                  <div className="font-semibold">Connection successful</div>
                  <div className="text-emerald-800/90">{active.discovery}</div>
                  <div className="mt-1 text-emerald-800/70">
                    Will pull <span className="font-medium">{active.sampleLabel}</span> into your workspace.
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="text-[12px] text-destructive">{error}</div>
            )}

            {!active.live && (
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
              <Badge variant="outline" className="text-[10px] font-normal">
                <Sparkles className="w-3 h-3 mr-1" /> Demo
              </Badge>
              <div className="flex items-center gap-2">
                {stage !== "tested" && stage !== "pulling" && (
                  <Button
                    onClick={handleTest}
                    disabled={stage === "testing" || missingRequired.length > 0}
                    variant="outline"
                    size="sm"
                    data-testid="connector-test"
                  >
                    {stage === "testing" ? (
                      <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Testing…</>
                    ) : (
                      <>Test connection</>
                    )}
                  </Button>
                )}
                {(stage === "tested" || stage === "pulling") && (
                  <Button
                    onClick={handlePull}
                    disabled={stage === "pulling"}
                    size="sm"
                    data-testid="connector-pull"
                  >
                    {stage === "pulling" ? (
                      <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Pulling…</>
                    ) : (
                      <>Pull into workspace <ArrowRight className="w-3.5 h-3.5 ml-1.5" /></>
                    )}
                  </Button>
                )}
              </div>
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
  onPicked: (file: File) => void;
  onClose: () => void;
}

function GoogleSheetsPicker({ apiBase, onPicked }: PickerProps) {
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pickingId, setPickingId] = useState<string | null>(null);

  const load = async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = `${apiBase}/api/connectors/google-sheets/files${q ? `?q=${encodeURIComponent(q)}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Listing failed (HTTP ${res.status})`);
      }
      const data = (await res.json()) as { files: DriveFile[] };
      setFiles(data.files);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not list files");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = async (file: DriveFile) => {
    setPickingId(file.id);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/api/connectors/google-sheets/download?fileId=${encodeURIComponent(file.id)}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Download failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const safe = file.name.replace(/[^\w. -]/g, "_");
      const f = new File([blob], `${safe}.xlsx`, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      onPicked(f);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not import file");
      setPickingId(null);
    }
  };

  return (
    <div className="mt-1 space-y-3">
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          load(query.trim());
        }}
      >
        <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your Google Sheets…"
          className="h-9 pl-8 text-sm"
        />
      </form>

      <div className="rounded-md border border-border max-h-[360px] overflow-y-auto">
        {loading && (
          <div className="flex items-center gap-2 p-4 text-[12px] text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading your spreadsheets…
          </div>
        )}
        {!loading && files && files.length === 0 && !error && (
          <div className="p-4 text-[12px] text-muted-foreground">
            No spreadsheets found{query ? ` matching "${query}"` : ""}.
          </div>
        )}
        {!loading && files && files.length > 0 && (
          <ul className="divide-y divide-border">
            {files.map((f) => {
              const busy = pickingId === f.id;
              const owner = f.owners?.[0]?.displayName;
              const when = f.modifiedTime
                ? new Date(f.modifiedTime).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })
                : "";
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    disabled={pickingId !== null}
                    onClick={() => pick(f)}
                    className="w-full text-left flex items-center gap-3 px-3 py-2.5 hover:bg-muted/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    data-testid={`gsheet-file-${f.id}`}
                  >
                    <FileSpreadsheet className="w-4 h-4 text-green-700 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-foreground truncate">{f.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {[owner, when].filter(Boolean).join(" • ")}
                      </div>
                    </div>
                    {busy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error && <div className="text-[12px] text-destructive">{error}</div>}

      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="w-3.5 h-3.5" />
        Read-only via your Google account. Pick a sheet — Gen-BI imports and builds the dashboard.
      </div>
    </div>
  );
}
