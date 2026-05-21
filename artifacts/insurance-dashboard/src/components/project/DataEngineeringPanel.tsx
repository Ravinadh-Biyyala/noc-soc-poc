import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Upload, Database, FileSpreadsheet, Wand2, Loader2, RefreshCw, Table as TableIcon,
  CheckCircle2, XCircle, Trash2, AlertTriangle, ChevronDown, ChevronRight, GitMerge, Filter, Layers,
} from "lucide-react";
import { ProjectUploadDialog } from "./UploadDialog";
import { ProjectPostgresDialog } from "./PostgresDialog";
import { ProjectGoogleSheetsDialog } from "./GoogleSheetsDialog";
import { cn } from "@/lib/utils";

interface Props {
  projectId: number;
  projectName: string;
}

type Sub = "connect" | "raw" | "transform";

interface RawTable { tableName: string; rowCount: number }

function useRawTables(projectId: number) {
  return useQuery<{ tables: RawTable[] }>({
    queryKey: ["project-raw-tables", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/raw-tables`, { credentials: "include" });
      if (!r.ok) return { tables: [] };
      return r.json();
    },
    staleTime: 5_000,
  });
}

export function ProjectDataEngineeringPanel({ projectId, projectName }: Props) {
  const [sub, setSub] = useState<Sub>("connect");

  return (
    <Tabs value={sub} onValueChange={(v) => setSub(v as Sub)}>
      <TabsList>
        <TabsTrigger value="connect">Connect to your data</TabsTrigger>
        <TabsTrigger value="raw">Raw browser</TabsTrigger>
        <TabsTrigger value="transform">Transformations</TabsTrigger>
      </TabsList>

      <TabsContent value="connect" className="pt-4">
        <ConnectData projectId={projectId} onImported={() => setSub("raw")} />
      </TabsContent>
      <TabsContent value="raw" className="pt-4">
        <RawBrowser projectId={projectId} />
      </TabsContent>
      <TabsContent value="transform" className="pt-4">
        <Transformations projectId={projectId} projectName={projectName} />
      </TabsContent>
    </Tabs>
  );
}

function ConnectData({ projectId, onImported }: { projectId: number; onImported: () => void }) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pgOpen, setPgOpen] = useState(false);
  const [sheetsOpen, setSheetsOpen] = useState(false);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Pick a source. Tables land in the <code className="text-xs bg-muted px-1.5 py-0.5 rounded">raw</code> schema
        of this project's own Postgres database (<code className="text-xs bg-muted px-1.5 py-0.5 rounded">proj_{projectId}</code>).
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SourceCard
          icon={Upload}
          label="Upload files"
          description="XLSX / XLS / CSV — multi-file picker. Every sheet becomes a raw table."
          onClick={() => setUploadOpen(true)}
          dataTestId="source-upload"
        />
        <SourceCard
          icon={Database}
          label="Postgres database"
          description="Connect to an external Postgres, pick tables, copy rows into the project raw schema."
          onClick={() => setPgOpen(true)}
          dataTestId="source-postgres"
        />
        <SourceCard
          icon={FileSpreadsheet}
          label="Google Sheets"
          description="Pick a Drive file; sync its sheets into the project raw schema."
          onClick={() => setSheetsOpen(true)}
          dataTestId="source-sheets"
        />
      </div>

      <ProjectUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} projectId={projectId} onImported={onImported} />
      <ProjectPostgresDialog open={pgOpen} onOpenChange={setPgOpen} projectId={projectId} onImported={onImported} />
      <ProjectGoogleSheetsDialog open={sheetsOpen} onOpenChange={setSheetsOpen} projectId={projectId} onImported={onImported} />
    </div>
  );
}

function SourceCard({
  icon: Icon,
  label,
  description,
  onClick,
  dataTestId,
}: {
  icon: typeof Upload;
  label: string;
  description: string;
  onClick: () => void;
  dataTestId: string;
}) {
  return (
    <Card
      onClick={onClick}
      className="cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all"
      data-testid={dataTestId}
    >
      <CardContent className="p-4 space-y-2">
        <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
        <Button variant="outline" size="sm" className="w-full mt-2" onClick={(e) => { e.stopPropagation(); onClick(); }}>
          Open
        </Button>
      </CardContent>
    </Card>
  );
}

function RawBrowser({ projectId }: { projectId: number }) {
  const { data, isLoading, refetch, isRefetching } = useRawTables(projectId);
  const tables = data?.tables ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Raw tables</p>
          <p className="text-xs text-muted-foreground">
            Tables in <code className="text-xs bg-muted px-1.5 py-0.5 rounded">proj_{projectId}.raw</code>.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} className="gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground gap-2 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : tables.length === 0 ? (
        <Card>
          <CardContent className="py-10 flex flex-col items-center gap-2 text-center text-muted-foreground">
            <Database className="w-6 h-6 opacity-50" />
            <p className="text-sm">No raw tables yet.</p>
            <p className="text-xs max-w-md">Use the Connect tab to ingest data.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {tables.map((t) => (
            <RawTableRow key={t.tableName} projectId={projectId} tableName={t.tableName} rowCount={t.rowCount} />
          ))}
        </div>
      )}
    </div>
  );
}

function RawTableRow({ projectId, tableName, rowCount }: { projectId: number; tableName: string; rowCount: number }) {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading } = useQuery<{ rows: Record<string, unknown>[]; fields: Array<{ name: string }> }>({
    queryKey: ["raw-preview", projectId, tableName],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/raw-tables/${tableName}/preview`, { credentials: "include" });
      if (!r.ok) return { rows: [], fields: [] };
      return r.json();
    },
    enabled: expanded,
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardContent className="p-3">
        <button
          className="w-full flex items-center justify-between gap-2 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex items-center gap-2 min-w-0">
            <TableIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-sm font-medium truncate">{tableName}</span>
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">~{rowCount.toLocaleString()} rows</span>
        </button>
        {expanded && (
          <div className="mt-3 border-t pt-2 -mx-1 overflow-x-auto">
            {isLoading ? (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 px-1 py-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading preview…
              </div>
            ) : !data || data.rows.length === 0 ? (
              <p className="text-xs text-muted-foreground px-1 py-2">No rows.</p>
            ) : (
              <table className="text-[11px] w-full">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    {data.fields.slice(0, 6).map((f) => <th key={f.name} className="px-1.5 py-1 font-medium">{f.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.slice(0, 10).map((row, i) => (
                    <tr key={i} className="border-t">
                      {data.fields.slice(0, 6).map((f) => (
                        <td key={f.name} className="px-1.5 py-1 truncate max-w-[120px]">{String(row[f.name] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface Transformation {
  id: number;
  projectId: number;
  kind: string;
  title: string;
  description: string | null;
  sourceTables: string[];
  sql: string;
  targetTableName: string;
  status: "proposed" | "accepted" | "applied" | "rejected";
  agentRationale: string | null;
  createdAt: string;
  appliedAt: string | null;
}

function useTransformations(projectId: number) {
  return useQuery<{ transformations: Transformation[] }>({
    queryKey: ["project-transformations", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/transformations`, { credentials: "include" });
      if (!r.ok) return { transformations: [] };
      return r.json();
    },
    staleTime: 2_000,
  });
}

function kindIcon(kind: string) {
  switch (kind) {
    case "join":      return GitMerge;
    case "cleanse":   return Filter;
    case "aggregate": return Layers;
    case "rename":    return TableIcon;
    default:          return Wand2;
  }
}

function statusTone(status: Transformation["status"]) {
  switch (status) {
    case "applied":  return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "accepted": return "bg-blue-50 text-blue-700 border-blue-200";
    case "rejected": return "bg-muted text-muted-foreground border-border";
    default:         return "bg-amber-50 text-amber-700 border-amber-200";
  }
}

function Transformations({ projectId, projectName }: { projectId: number; projectName: string }) {
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentNote, setAgentNote] = useState<string | null>(null);
  const [applyNote, setApplyNote] = useState<string | null>(null);
  const { data, isLoading, refetch } = useTransformations(projectId);
  const queryClient = useQueryClient();

  const proposed = data?.transformations.filter((t) => t.status === "proposed") ?? [];
  const accepted = data?.transformations.filter((t) => t.status === "accepted" || t.status === "applied") ?? [];

  const runSuggest = async () => {
    setSuggesting(true);
    setError(null);
    setAgentNote(null);
    try {
      const resp = await fetch(`/api/projects/${projectId}/agents/data-engineer/suggest`, {
        method: "POST",
        credentials: "include",
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.error || `Suggest failed (${resp.status})`);
      setAgentNote(
        body.proposedCount > 0
          ? `Agent proposed ${body.proposedCount} transformation${body.proposedCount === 1 ? "" : "s"}.`
          : "Agent ran but did not propose any new transformations.",
      );
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ["project-warehouse-status", projectId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run agent");
    } finally {
      setSuggesting(false);
    }
  };

  const accept = async (tid: number) => {
    setError(null);
    setApplyNote(null);
    try {
      const resp = await fetch(`/api/projects/${projectId}/transformations/${tid}/accept`, {
        method: "POST",
        credentials: "include",
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.error || `Accept failed (${resp.status})`);
      if (body.dependenciesApplied?.length) {
        setApplyNote(`Auto-applied ${body.dependenciesApplied.length} upstream table${body.dependenciesApplied.length === 1 ? "" : "s"} first: ${body.dependenciesApplied.join(", ")}`);
      }
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ["project-warehouse-status", projectId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply transformation");
    }
  };

  const reject = async (tid: number) => {
    setError(null);
    try {
      const resp = await fetch(`/api/projects/${projectId}/transformations/${tid}/reject`, {
        method: "POST",
        credentials: "include",
      });
      if (!resp.ok) throw new Error(`Reject failed (${resp.status})`);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reject");
    }
  };

  const remove = async (tid: number) => {
    setError(null);
    try {
      const resp = await fetch(`/api/projects/${projectId}/transformations/${tid}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!resp.ok && resp.status !== 204) throw new Error(`Delete failed (${resp.status})`);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">DataEngineerAgent suggestions</p>
          <p className="text-xs text-muted-foreground">
            The agent inspects raw tables and proposes cleansing, joins, aggregations, and views
            tailored to project "{projectName}".
          </p>
        </div>
        <Button size="sm" onClick={runSuggest} disabled={suggesting} className="gap-1.5">
          {suggesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
          Ask agent for suggestions
        </Button>
      </div>

      {agentNote && (
        <div className="text-xs text-muted-foreground bg-muted/40 border rounded p-2">{agentNote}</div>
      )}
      {applyNote && (
        <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded p-2">{applyNote}</div>
      )}
      {error && (
        <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground gap-2 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (data?.transformations.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-10 flex flex-col items-center gap-2 text-center text-muted-foreground">
            <Wand2 className="w-6 h-6 opacity-50" />
            <p className="text-sm">No transformations yet.</p>
            <p className="text-xs max-w-md">
              Ingest data via the Connect tab, then click "Ask agent for suggestions" above.
              Accepted transformations populate <code className="text-xs bg-muted px-1.5 py-0.5 rounded">proj_{projectId}.warehouse</code>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Column title="Proposed" emptyHint="The agent's open proposals show here. Accept to run, reject to dismiss.">
            {proposed.map((t) => (
              <TransformationCard
                key={t.id}
                t={t}
                onAccept={() => accept(t.id)}
                onReject={() => reject(t.id)}
                onDelete={() => remove(t.id)}
              />
            ))}
          </Column>
          <Column title="Accepted / Applied" emptyHint="Once you accept a proposal, it appears here.">
            {accepted.map((t) => (
              <TransformationCard
                key={t.id}
                t={t}
                onAccept={() => accept(t.id)}
                onReject={() => reject(t.id)}
                onDelete={() => remove(t.id)}
              />
            ))}
          </Column>
        </div>
      )}
    </div>
  );
}

function Column({ title, emptyHint, children }: { title: string; emptyHint: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-xs text-muted-foreground">{emptyHint}</CardContent>
        </Card>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  );
}

function TransformationCard({
  t,
  onAccept,
  onReject,
  onDelete,
}: {
  t: Transformation;
  onAccept: () => void;
  onReject: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<"accept" | "reject" | "delete" | null>(null);
  const Icon = kindIcon(t.kind);

  const wrap = (op: "accept" | "reject" | "delete", fn: () => Promise<void> | void) => async () => {
    setBusy(op);
    try { await fn(); } finally { setBusy(null); }
  };

  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Icon className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold truncate">{t.title}</p>
              <Badge variant="outline" className={cn("text-[9px] uppercase", statusTone(t.status))}>{t.status}</Badge>
              <Badge variant="outline" className="text-[9px] uppercase">{t.kind}</Badge>
            </div>
            {t.description && <p className="text-xs text-muted-foreground mt-1">{t.description}</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground pl-9">
          <span>→ <code className="bg-muted px-1 py-0.5 rounded">warehouse.{t.targetTableName}</code></span>
          {t.sourceTables?.length > 0 && (
            <span>from {t.sourceTables.map((s) => <code key={s} className="bg-muted px-1 py-0.5 rounded mr-1">{s}</code>)}</span>
          )}
        </div>

        <button
          className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 pl-9"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {expanded ? "Hide" : "Show"} SQL{t.agentRationale ? " & rationale" : ""}
        </button>

        {expanded && (
          <div className="pl-9 space-y-2">
            {t.agentRationale && (
              <div className="text-[11px] text-muted-foreground italic border-l-2 border-muted pl-2">
                "{t.agentRationale}"
              </div>
            )}
            <pre className="text-[10px] bg-muted/40 border rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">{t.sql}</pre>
          </div>
        )}

        <div className="flex items-center gap-1 pt-1 border-t pl-9">
          {t.status === "proposed" && (
            <>
              <Button size="sm" variant="default" onClick={wrap("accept", onAccept)} disabled={busy !== null} className="h-7 gap-1 text-xs">
                {busy === "accept" ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                Accept &amp; apply
              </Button>
              <Button size="sm" variant="ghost" onClick={wrap("reject", onReject)} disabled={busy !== null} className="h-7 gap-1 text-xs">
                <XCircle className="w-3 h-3" /> Reject
              </Button>
            </>
          )}
          {t.status === "accepted" && (
            <Button size="sm" variant="default" onClick={wrap("accept", onAccept)} disabled={busy !== null} className="h-7 gap-1 text-xs">
              {busy === "accept" ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Retry apply
            </Button>
          )}
          {(t.status === "applied" || t.status === "rejected") && (
            <Button size="sm" variant="ghost" onClick={wrap("delete", onDelete)} disabled={busy !== null} className="h-7 gap-1 text-xs text-muted-foreground">
              <Trash2 className="w-3 h-3" /> Delete
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
