import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, Wand2, CheckCircle2, XCircle, Trash2, Gauge, AlertTriangle, Pencil, Save, X,
} from "lucide-react";

interface Props {
  projectId: number;
  projectName: string;
}

interface Metric {
  id: number;
  workspaceId: number;
  metricName: string;
  description: string | null;
  sqlFormula: string;
  dependsOnTables: string[];
  status: "proposed" | "applied" | "rejected";
  agentRationale: string | null;
  createdAt: string;
}

function useMetrics(projectId: number) {
  return useQuery<{ metrics: Metric[] }, Error>({
    queryKey: ["project-metrics", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/metrics`, { credentials: "include" });
      if (r.status === 503 || r.status === 500) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "Internal server error");
      }
      if (!r.ok) return { metrics: [] };
      return r.json();
    },
    staleTime: 5_000,
    retry: false,
  });
}

export function ProjectMetricArchitectPanel({ projectId, projectName }: Props) {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useMetrics(projectId);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["project-metrics", projectId] });

  const acceptMut = useMutation({
    mutationFn: async (mid: number) => {
      const r = await fetch(`/api/projects/${projectId}/metrics/${mid}/accept`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Accept failed");
      return r.json();
    },
    onSuccess: invalidate,
  });

  const rejectMut = useMutation({
    mutationFn: async (mid: number) => {
      const r = await fetch(`/api/projects/${projectId}/metrics/${mid}/reject`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Reject failed");
      return r.json();
    },
    onSuccess: invalidate,
  });

  const deleteMut = useMutation({
    mutationFn: async (mid: number) => {
      const r = await fetch(`/api/projects/${projectId}/metrics/${mid}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: invalidate,
  });

  const updateMut = useMutation({
    mutationFn: async ({ mid, payload }: { mid: number; payload: Partial<Metric> }) => {
      const r = await fetch(`/api/projects/${projectId}/metrics/${mid}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Update failed");
      return r.json();
    },
    onSuccess: invalidate,
  });

  async function runAgent() {
    setAgentRunning(true);
    setAgentError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/agents/metric-architect/suggest`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "Agent run failed");
      }
      await refetch();
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "Agent run failed");
    } finally {
      setAgentRunning(false);
    }
  }

  const metrics = data?.metrics ?? [];
  const applied = metrics.filter((m) => m.status === "applied");
  const proposed = metrics.filter((m) => m.status === "proposed");

  return (
    <div className="space-y-4" data-testid="panel-metric-architect">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Gauge className="w-4 h-4" /> Metric Architect
          </h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Defines business KPIs as SQL formulas. Measures stay as runtime expressions — never as physical columns —
            so aggregations by Year/Region/etc. remain mathematically correct.
          </p>
        </div>
        <Button onClick={runAgent} disabled={agentRunning} size="sm" className="gap-1.5 shrink-0">
          {agentRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
          {agentRunning ? "Defining..." : "Suggest metrics"}
        </Button>
      </div>

      {(agentError ?? (isError ? (error?.message ?? "Could not load metrics") : null)) && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardContent className="py-3 text-sm flex items-center gap-2 text-red-600">
            <AlertTriangle className="w-4 h-4" />
            {agentError ?? error?.message ?? "Could not load metrics"}
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Loading...</CardContent></Card>
      )}

      {!isLoading && metrics.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <p className="text-sm font-medium">No metrics defined yet</p>
            <p className="text-xs text-muted-foreground">
              Click <strong>Suggest metrics</strong> to have the Metric Architect propose KPIs for <strong>{projectName}</strong>.
            </p>
          </CardContent>
        </Card>
      )}

      {applied.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Applied ({applied.length})</p>
          {applied.map((m) => (
            <MetricCard
              key={m.id}
              metric={m}
              onDelete={() => deleteMut.mutate(m.id)}
              onUpdate={(payload) => updateMut.mutate({ mid: m.id, payload })}
            />
          ))}
        </div>
      )}

      {proposed.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Proposed ({proposed.length})</p>
          {proposed.map((m) => (
            <MetricCard
              key={m.id}
              metric={m}
              onAccept={() => acceptMut.mutate(m.id)}
              onReject={() => rejectMut.mutate(m.id)}
              onDelete={() => deleteMut.mutate(m.id)}
              onUpdate={(payload) => updateMut.mutate({ mid: m.id, payload })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MetricCard({
  metric,
  onAccept,
  onReject,
  onDelete,
  onUpdate,
}: {
  metric: Metric;
  onAccept?: () => void;
  onReject?: () => void;
  onDelete?: () => void;
  onUpdate?: (payload: Partial<Metric>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftFormula, setDraftFormula] = useState(metric.sqlFormula);
  const [draftDescription, setDraftDescription] = useState(metric.description ?? "");

  const statusColor: Record<Metric["status"], string> = {
    proposed: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    applied: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    rejected: "bg-muted text-muted-foreground border-muted",
  };

  function cancel() {
    setDraftFormula(metric.sqlFormula);
    setDraftDescription(metric.description ?? "");
    setEditing(false);
  }

  function save() {
    onUpdate?.({ sqlFormula: draftFormula, description: draftDescription });
    setEditing(false);
  }

  return (
    <Card data-testid={`metric-card-${metric.id}`}>
      <CardContent className="py-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-sm font-mono font-semibold">{metric.metricName}</code>
          <Badge variant="outline" className={statusColor[metric.status]}>{metric.status}</Badge>
          {metric.dependsOnTables.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              depends on: {metric.dependsOnTables.join(", ")}
            </span>
          )}
        </div>

        {!editing ? (
          <>
            {metric.description && (
              <p className="text-xs text-muted-foreground">{metric.description}</p>
            )}
            <pre className="text-[11px] font-mono bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap">{metric.sqlFormula}</pre>
            {metric.agentRationale && (
              <p className="text-[10px] text-muted-foreground italic">{metric.agentRationale}</p>
            )}
          </>
        ) : (
          <>
            <Textarea
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              rows={2}
              placeholder="Description"
              className="text-xs"
            />
            <Textarea
              value={draftFormula}
              onChange={(e) => setDraftFormula(e.target.value)}
              rows={2}
              placeholder="SQL formula (expression only — no statements)"
              className="text-xs font-mono"
            />
            <p className="text-[10px] text-muted-foreground">
              Must be a SQL expression (e.g. <code>SUM(revenue) - SUM(cost)</code>) — no semicolons, no CREATE/INSERT/UPDATE/DELETE.
            </p>
          </>
        )}

        <div className="flex items-center gap-2 pt-1">
          {editing ? (
            <>
              <Button size="sm" onClick={save} className="gap-1.5">
                <Save className="w-3.5 h-3.5" /> Save
              </Button>
              <Button size="sm" variant="ghost" onClick={cancel} className="gap-1.5">
                <X className="w-3.5 h-3.5" /> Cancel
              </Button>
            </>
          ) : (
            <>
              {metric.status === "proposed" && onAccept && (
                <Button size="sm" onClick={onAccept} className="gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Accept
                </Button>
              )}
              {metric.status === "proposed" && onReject && (
                <Button size="sm" variant="outline" onClick={onReject} className="gap-1.5">
                  <XCircle className="w-3.5 h-3.5" /> Reject
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)} className="gap-1.5">
                <Pencil className="w-3.5 h-3.5" /> Edit
              </Button>
              {onDelete && (
                <Button size="sm" variant="ghost" onClick={onDelete} className="gap-1.5 ml-auto text-destructive">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </Button>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
