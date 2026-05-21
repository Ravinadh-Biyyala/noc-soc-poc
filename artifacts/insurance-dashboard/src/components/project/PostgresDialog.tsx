import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Database, Loader2, CheckCircle2, AlertTriangle, ArrowLeft } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  onImported: () => void;
}

type Step = "credentials" | "pick" | "done";

interface SourceTable { schema: string; table: string }

interface PgCreds {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  ssl: "prefer" | "require" | "disable";
}

const EMPTY: PgCreds = { host: "localhost", port: "5432", database: "", user: "", password: "", ssl: "prefer" };

export function ProjectPostgresDialog({ open, onOpenChange, projectId, onImported }: Props) {
  const [step, setStep] = useState<Step>("credentials");
  const [creds, setCreds] = useState<PgCreds>(EMPTY);
  const [tables, setTables] = useState<SourceTable[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<Array<{ tableName: string; rowCount: number }>>([]);
  const queryClient = useQueryClient();

  const reset = () => {
    setStep("credentials");
    setCreds(EMPTY);
    setTables([]);
    setSelected(new Set());
    setBusy(false);
    setError(null);
    setImported([]);
  };

  const updateCred = <K extends keyof PgCreds>(k: K, v: PgCreds[K]) =>
    setCreds((prev) => ({ ...prev, [k]: v }));

  const credsPayload = () => ({
    host: creds.host.trim(),
    port: parseInt(creds.port, 10) || 5432,
    database: creds.database.trim(),
    user: creds.user.trim(),
    password: creds.password,
    ssl: creds.ssl,
  });

  const handleConnect = async () => {
    if (!creds.host || !creds.database || !creds.user) {
      setError("host, database, and user are required");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const resp = await fetch(`/api/projects/${projectId}/ingest/postgres/tables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credsPayload()),
        credentials: "include",
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `Connect failed (${resp.status})`);
      setTables(data.tables ?? []);
      setStep("pick");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  };

  const toggleTable = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const handleImport = async () => {
    if (selected.size === 0) return;
    setError(null);
    setBusy(true);
    try {
      const payload = {
        ...credsPayload(),
        tables: tables.filter((t) => selected.has(`${t.schema}.${t.table}`)),
      };
      const resp = await fetch(`/api/projects/${projectId}/ingest/postgres/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `Import failed (${resp.status})`);
      setImported(data.imported ?? []);
      setStep("done");
      await queryClient.invalidateQueries({ queryKey: ["project-raw-tables", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["project-warehouse-status", projectId] });
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            {step === "credentials" && "Connect to a Postgres database"}
            {step === "pick" && "Pick tables to import"}
            {step === "done" && "Import complete"}
          </DialogTitle>
          <DialogDescription>
            {step === "credentials" && "Credentials are used only for this request. They are not stored unless you save them as a project data source."}
            {step === "pick" && `Connected to ${creds.database} on ${creds.host}. Select the tables to copy into this project's raw schema.`}
            {step === "done" && "Tables copied into the project's raw schema."}
          </DialogDescription>
        </DialogHeader>

        {step === "credentials" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="pg-host">Host</Label>
              <Input id="pg-host" value={creds.host} onChange={(e) => updateCred("host", e.target.value)} placeholder="localhost" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pg-port">Port</Label>
              <Input id="pg-port" value={creds.port} onChange={(e) => updateCred("port", e.target.value)} placeholder="5432" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pg-ssl">SSL</Label>
              <select
                id="pg-ssl"
                value={creds.ssl}
                onChange={(e) => updateCred("ssl", e.target.value as PgCreds["ssl"])}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="prefer">prefer</option>
                <option value="require">require</option>
                <option value="disable">disable</option>
              </select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="pg-db">Database</Label>
              <Input id="pg-db" value={creds.database} onChange={(e) => updateCred("database", e.target.value)} placeholder="my_app_production" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pg-user">User</Label>
              <Input id="pg-user" value={creds.user} onChange={(e) => updateCred("user", e.target.value)} placeholder="postgres" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pg-pwd">Password</Label>
              <Input id="pg-pwd" type="password" value={creds.password} onChange={(e) => updateCred("password", e.target.value)} />
            </div>
          </div>
        )}

        {step === "pick" && (
          <div className="space-y-2 max-h-96 overflow-y-auto border rounded p-2">
            {tables.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No tables found.</p>
            ) : (
              tables.map((t) => {
                const key = `${t.schema}.${t.table}`;
                return (
                  <label key={key} className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50 rounded cursor-pointer text-sm">
                    <Checkbox checked={selected.has(key)} onCheckedChange={() => toggleTable(key)} />
                    <span className="text-muted-foreground">{t.schema}.</span>
                    <span className="font-medium">{t.table}</span>
                  </label>
                );
              })
            )}
          </div>
        )}

        {step === "done" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
              <span className="font-medium">Imported {imported.length} {imported.length === 1 ? "table" : "tables"}</span>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {imported.map((r, i) => (
                <div key={i} className="text-xs flex items-center justify-between gap-2 p-2 bg-muted/40 rounded border">
                  <span className="font-medium">{r.tableName}</span>
                  <span className="text-muted-foreground">{r.rowCount.toLocaleString()} rows</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter>
          {step === "credentials" && (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button onClick={handleConnect} disabled={busy} className="gap-1.5">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                Connect
              </Button>
            </>
          )}
          {step === "pick" && (
            <>
              <Button variant="ghost" onClick={() => setStep("credentials")} disabled={busy} className="gap-1.5">
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>
              <Button onClick={handleImport} disabled={busy || selected.size === 0} className="gap-1.5">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Import {selected.size > 0 ? `${selected.size} ${selected.size === 1 ? "table" : "tables"}` : ""}
              </Button>
            </>
          )}
          {step === "done" && (
            <Button onClick={() => { reset(); onOpenChange(false); }}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
