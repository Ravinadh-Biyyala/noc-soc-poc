import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Cloud,
  RefreshCw,
  Unplug,
  AlertCircle,
  FileSpreadsheet,
} from "lucide-react";

interface SfColumn {
  name: string;
  label: string;
}

interface DcrReport {
  columns: SfColumn[];
  records: Array<Record<string, unknown>>;
  totalSize: number;
  fetchedAt: string;
}

interface SfStatus {
  configured: boolean;
  connected: boolean;
  instanceUrl: string | null;
}

function fmt(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const s = String(value);
  // Render Salesforce ISO datetimes compactly
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  }
  return s;
}

export default function Reports() {
  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");

  const [status, setStatus] = useState<SfStatus | null>(null);
  const [report, setReport] = useState<DcrReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/salesforce/reports/dcr`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 401) {
          setStatus((s) => (s ? { ...s, connected: false } : s));
          setReport(null);
          return;
        }
        throw new Error(body.error ?? `Server returned ${res.status}`);
      }
      setReport((await res.json()) as DcrReport);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load the DCR report");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  // On mount: read the OAuth error (if redirected back with one), check the
  // connection status, and auto-load the report when already connected.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sfError = params.get("sf_error");
    if (sfError) setError(sfError);
    if (sfError || params.get("sf_connected")) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/salesforce/auth/status`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const s = (await res.json()) as SfStatus;
        setStatus(s);
        if (s.connected) void loadReport();
      } catch {
        setStatus({ configured: false, connected: false, instanceUrl: null });
      }
    })();
  }, [apiBase, loadReport]);

  const connect = () => {
    window.location.href = `${apiBase}/api/salesforce/auth/login`;
  };

  const disconnect = async () => {
    await fetch(`${apiBase}/api/salesforce/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    setStatus((s) => (s ? { ...s, connected: false } : s));
    setReport(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-sky-700" />
            Reports
          </h1>
          <p className="text-xs text-muted-foreground">
            Live reports pulled from your connected systems.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">DCR — Data Change Requests</CardTitle>
            <Badge variant="outline" className="text-sky-700 bg-sky-50 border-sky-200 gap-1">
              <Cloud className="w-3 h-3" /> Salesforce
            </Badge>
            {status?.connected && (
              <Badge variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-200">
                Connected
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {status?.connected ? (
              <>
                <Button size="sm" onClick={() => void loadReport()} disabled={loading}>
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
                  {loading ? "Refreshing…" : "Reload"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void disconnect()} title="Disconnect Salesforce">
                  <Unplug className="w-3.5 h-3.5" />
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={connect} disabled={status ? !status.configured : true}>
                <Cloud className="w-3.5 h-3.5 mr-1.5" />
                Connect to Salesforce
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {status && !status.configured && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-3">
              Salesforce is not configured. Set <code>SF_CLIENT_ID</code> and{" "}
              <code>SF_LOGIN_URL</code> in <code>.env</code> and restart the API server.
            </p>
          )}

          {error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-3 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
            </p>
          )}

          {!status?.connected && !error && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Connect to Salesforce to pull DCR records from your org.
            </p>
          )}

          {status?.connected && report && (
            <>
              <p className="text-xs text-muted-foreground mb-2">
                {report.totalSize} record{report.totalSize === 1 ? "" : "s"} · refreshed{" "}
                {new Date(report.fetchedAt).toLocaleTimeString()}
              </p>
              <div className="overflow-x-auto border rounded-md max-h-[65vh] overflow-y-auto">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr>
                      {report.columns.map((c) => (
                        <th
                          key={c.name}
                          className="text-left font-medium px-3 py-2 border-b whitespace-nowrap"
                        >
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.records.length === 0 ? (
                      <tr>
                        <td
                          colSpan={report.columns.length}
                          className="px-3 py-8 text-center text-muted-foreground"
                        >
                          No DCR records found in the org.
                        </td>
                      </tr>
                    ) : (
                      report.records.map((row, ri) => (
                        <tr key={(row.Id as string) ?? ri} className={ri % 2 === 0 ? "bg-background" : "bg-muted/10"}>
                          {report.columns.map((c) => (
                            <td key={c.name} className="px-3 py-1.5 border-b whitespace-nowrap max-w-[260px] overflow-hidden text-ellipsis">
                              {fmt(row[c.name])}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {status?.connected && !report && loading && (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading DCR records…</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
