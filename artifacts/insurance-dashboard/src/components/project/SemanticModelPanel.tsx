import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Wand2, CheckCircle2, XCircle, Trash2, Network, AlertTriangle } from "lucide-react";

interface Props {
  projectId: number;
  projectName: string;
}

interface SemanticJoin {
  from: string;
  to: string;
  cardinality: string;
}

interface SemanticModel {
  id: number;
  workspaceId: number;
  status: "proposed" | "applied" | "rejected";
  graphDefinition: {
    facts: string[];
    dimensions: string[];
    joins: SemanticJoin[];
  };
  agentRationale: string | null;
  createdAt: string;
}

function useSemanticModels(projectId: number) {
  return useQuery<{ semanticModels: SemanticModel[] }, Error>({
    queryKey: ["project-semantic-models", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/semantic-model`, { credentials: "include" });
      if (r.status === 503 || r.status === 500) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "Internal server error");
      }
      if (!r.ok) return { semanticModels: [] };
      return r.json();
    },
    staleTime: 5_000,
    retry: false,
  });
}

export function ProjectSemanticModelPanel({ projectId, projectName }: Props) {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useSemanticModels(projectId);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["project-semantic-models", projectId] });

  const acceptMut = useMutation({
    mutationFn: async (smId: number) => {
      const r = await fetch(`/api/projects/${projectId}/semantic-model/${smId}/accept`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Accept failed");
      return r.json();
    },
    onSuccess: invalidate,
  });

  const rejectMut = useMutation({
    mutationFn: async (smId: number) => {
      const r = await fetch(`/api/projects/${projectId}/semantic-model/${smId}/reject`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Reject failed");
      return r.json();
    },
    onSuccess: invalidate,
  });

  const deleteMut = useMutation({
    mutationFn: async (smId: number) => {
      const r = await fetch(`/api/projects/${projectId}/semantic-model/${smId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: invalidate,
  });

  async function runAgent() {
    setAgentRunning(true);
    setAgentError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/agents/data-modeler/suggest`, {
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

  const models = data?.semanticModels ?? [];
  const applied = models.find((m) => m.status === "applied");
  const proposed = models.filter((m) => m.status === "proposed");

  return (
    <div className="space-y-4" data-testid="panel-semantic-model">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Network className="w-4 h-4" /> Semantic Model
          </h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            The Data Modeler agent inspects <code className="text-[10px] bg-muted px-1 py-0.5 rounded">{projectName}</code>'s warehouse and proposes a star schema (facts, dimensions, joins).
            No tables are altered — the graph is metadata the Metric Architect and BI Copilot use to write correct queries.
          </p>
        </div>
        <Button onClick={runAgent} disabled={agentRunning} size="sm" className="gap-1.5 shrink-0">
          {agentRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
          {agentRunning ? "Modeling..." : applied ? "Re-model" : "Generate"}
        </Button>
      </div>

      {(agentError ?? (isError ? (error?.message ?? "Could not load semantic models") : null)) && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardContent className="py-3 text-sm flex items-center gap-2 text-red-600">
            <AlertTriangle className="w-4 h-4" />
            {agentError ?? error?.message ?? "Could not load semantic models"}
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Loading...</CardContent></Card>
      )}

      {!isLoading && models.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <p className="text-sm font-medium">No semantic model yet</p>
            <p className="text-xs text-muted-foreground">Click <strong>Generate</strong> to have the Data Modeler propose one.</p>
          </CardContent>
        </Card>
      )}

      {applied && (
        <SemanticModelCard
          model={applied}
          onDelete={() => deleteMut.mutate(applied.id)}
        />
      )}

      {proposed.map((m) => (
        <SemanticModelCard
          key={m.id}
          model={m}
          onAccept={() => acceptMut.mutate(m.id)}
          onReject={() => rejectMut.mutate(m.id)}
          onDelete={() => deleteMut.mutate(m.id)}
        />
      ))}
    </div>
  );
}

function SemanticModelCard({
  model,
  onAccept,
  onReject,
  onDelete,
}: {
  model: SemanticModel;
  onAccept?: () => void;
  onReject?: () => void;
  onDelete?: () => void;
}) {
  const statusColor: Record<SemanticModel["status"], string> = {
    proposed: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    applied: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    rejected: "bg-muted text-muted-foreground border-muted",
  };

  const { facts, dimensions, joins } = model.graphDefinition;

  return (
    <Card data-testid={`semantic-model-card-${model.id}`}>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={statusColor[model.status]}>{model.status}</Badge>
          <span className="text-xs text-muted-foreground">
            {new Date(model.createdAt).toLocaleString()}
          </span>
        </div>

        {model.agentRationale && (
          <p className="text-xs text-muted-foreground italic">{model.agentRationale}</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div>
            <p className="font-medium mb-1">Facts ({facts.length})</p>
            <ul className="space-y-0.5">
              {facts.length === 0 && <li className="text-muted-foreground">(none)</li>}
              {facts.map((f) => (
                <li key={f} className="font-mono text-[11px] bg-blue-500/10 px-1.5 py-0.5 rounded inline-block mr-1">{f}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-medium mb-1">Dimensions ({dimensions.length})</p>
            <ul className="space-y-0.5">
              {dimensions.length === 0 && <li className="text-muted-foreground">(none)</li>}
              {dimensions.map((d) => (
                <li key={d} className="font-mono text-[11px] bg-purple-500/10 px-1.5 py-0.5 rounded inline-block mr-1">{d}</li>
              ))}
            </ul>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium mb-1">Joins ({joins.length})</p>
          {joins.length === 0 && <p className="text-xs text-muted-foreground">(no joins proposed)</p>}
          <ul className="space-y-1">
            {joins.map((j, i) => (
              <li key={i} className="text-[11px] font-mono flex items-center gap-2">
                <span className="bg-muted px-1.5 py-0.5 rounded">{j.from}</span>
                <span className="text-muted-foreground">→</span>
                <span className="bg-muted px-1.5 py-0.5 rounded">{j.to}</span>
                <Badge variant="outline" className="text-[9px] h-4">{j.cardinality}</Badge>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-2 pt-2 border-t">
          {model.status === "proposed" && onAccept && (
            <Button size="sm" onClick={onAccept} className="gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Accept
            </Button>
          )}
          {model.status === "proposed" && onReject && (
            <Button size="sm" variant="outline" onClick={onReject} className="gap-1.5">
              <XCircle className="w-3.5 h-3.5" /> Reject
            </Button>
          )}
          {onDelete && (
            <Button size="sm" variant="ghost" onClick={onDelete} className="gap-1.5 ml-auto text-destructive">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
