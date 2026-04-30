import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListJoinSuggestions,
  useListJoins,
  useCreateJoin,
  useUpdateJoin,
  useDeleteJoin,
  usePreviewJoin,
  useListPreparedDatasets,
  useCreatePreparedDataset,
  useDeletePreparedDataset,
  useSuggestMetrics,
  useListWorkspaceDatasets,
  useGetDataset,
  PreviewJoinBodyJoinType,
  getListJoinSuggestionsQueryKey,
  getListJoinsQueryKey,
  getListPreparedDatasetsQueryKey,
  getListMetricsQueryKey,
  getGetDatasetQueryKey,
  type JoinSuggestion,
  type Join,
  type PreparedDataset,
  type Dataset,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Check,
  X,
  Eye,
  Pencil,
  Plus,
  Trash2,
  Database,
  GitMerge,
  Loader2,
} from "lucide-react";

interface JoinStudioProps {
  workspaceId: number;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function confidenceTone(c: number) {
  if (c >= 0.8) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (c >= 0.5) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-red-50 text-red-700 border-red-200";
}

function findDataset(datasets: Dataset[] | undefined, id: number): Dataset | undefined {
  return datasets?.find((d) => d.id === id);
}

export default function JoinStudio({ workspaceId }: JoinStudioProps) {
  const queryClient = useQueryClient();

  const { data: datasets, isLoading: dsLoading } = useListWorkspaceDatasets(workspaceId);
  const { data: suggestionsRes, isLoading: sLoading } = useListJoinSuggestions(workspaceId);
  const { data: joins, isLoading: jLoading } = useListJoins(workspaceId);
  const { data: prepared, isLoading: pLoading } = useListPreparedDatasets(workspaceId);

  const suggestions = suggestionsRes?.suggestions ?? [];
  const joinList = joins ?? [];
  const preparedList = prepared ?? [];

  const acceptedJoins = useMemo(
    () => joinList.filter((j) => j.status === "accepted"),
    [joinList],
  );

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListJoinSuggestionsQueryKey(workspaceId) });
    queryClient.invalidateQueries({ queryKey: getListJoinsQueryKey(workspaceId) });
    queryClient.invalidateQueries({ queryKey: getListPreparedDatasetsQueryKey(workspaceId) });
    queryClient.invalidateQueries({ queryKey: getListMetricsQueryKey(workspaceId) });
  };

  const createJoin = useCreateJoin({
    mutation: { onSuccess: invalidateAll },
  });
  const updateJoin = useUpdateJoin({
    mutation: { onSuccess: invalidateAll },
  });
  const deleteJoin = useDeleteJoin({
    mutation: { onSuccess: invalidateAll },
  });
  const previewJoin = usePreviewJoin();
  const createPrepared = useCreatePreparedDataset({
    mutation: { onSuccess: invalidateAll },
  });
  const deletePrepared = useDeletePreparedDataset({
    mutation: { onSuccess: invalidateAll },
  });
  const suggestMetrics = useSuggestMetrics({
    mutation: { onSuccess: invalidateAll },
  });

  // Modify dialog state
  const [modifyTarget, setModifyTarget] = useState<
    | {
        kind: "suggestion";
        suggestion: JoinSuggestion;
      }
    | {
        kind: "join";
        join: Join;
      }
    | null
  >(null);

  // Manual add state
  const [showManual, setShowManual] = useState(false);

  // Preview drawer state. `error` displays in the drawer, `body` is the
  // computed preview. Each preview request bumps a token so stale responses
  // can never overwrite a newer preview.
  const [previewState, setPreviewState] = useState<
    | {
        title: string;
        body: { columns: string[]; rows: { [k: string]: unknown }[]; totalRows: number } | null;
        error: string | null;
      }
    | null
  >(null);
  const previewToken = useRef(0);

  // Create prepared dataset state
  const [showPrepared, setShowPrepared] = useState(false);
  const [preparedSeed, setPreparedSeed] = useState<{
    name: string;
    baseDatasetId: number;
    joinIds: number[];
  } | null>(null);

  // Lineage detail state
  const [openLineage, setOpenLineage] = useState<number | null>(null);

  function isAlreadyPersisted(s: JoinSuggestion): Join | undefined {
    return joinList.find(
      (j) =>
        j.leftDatasetId === s.leftDatasetId &&
        j.rightDatasetId === s.rightDatasetId &&
        j.leftColumn === s.leftColumn &&
        j.rightColumn === s.rightColumn,
    );
  }

  function preparedAlreadyCovers(baseId: number, joinId: number): boolean {
    return preparedList.some(
      (pd) =>
        pd.baseDatasetId === baseId &&
        Array.isArray(pd.joinIds) &&
        pd.joinIds.includes(joinId),
    );
  }

  async function acceptSuggestion(s: JoinSuggestion) {
    const created = await createJoin.mutateAsync({
      id: workspaceId,
      data: {
        leftDatasetId: s.leftDatasetId,
        rightDatasetId: s.rightDatasetId,
        leftColumn: s.leftColumn,
        rightColumn: s.rightColumn,
        joinType: s.recommendedJoinType,
        status: "accepted",
        confidence: s.confidence,
        matchRate: s.matchRate,
        unmatchedCount: s.unmatchedCount,
        source: "ai",
      },
    });
    if (created?.id && !preparedAlreadyCovers(s.leftDatasetId, created.id)) {
      setPreparedSeed({
        name: `${s.leftDatasetName} + ${s.rightDatasetName}`,
        baseDatasetId: s.leftDatasetId,
        joinIds: [created.id],
      });
      setShowPrepared(true);
    }
  }

  async function rejectSuggestion(s: JoinSuggestion) {
    await createJoin.mutateAsync({
      id: workspaceId,
      data: {
        leftDatasetId: s.leftDatasetId,
        rightDatasetId: s.rightDatasetId,
        leftColumn: s.leftColumn,
        rightColumn: s.rightColumn,
        joinType: s.recommendedJoinType,
        status: "rejected",
        confidence: s.confidence,
        matchRate: s.matchRate,
        unmatchedCount: s.unmatchedCount,
        source: "ai",
      },
    });
  }

  async function runPreview(
    title: string,
    payload: {
      leftDatasetId: number;
      rightDatasetId: number;
      leftColumn: string;
      rightColumn: string;
      joinType: string;
    },
  ) {
    const token = ++previewToken.current;
    setPreviewState({ title, body: null, error: null });
    try {
      const res = await previewJoin.mutateAsync({
        id: workspaceId,
        data: {
          ...payload,
          joinType: payload.joinType as PreviewJoinBodyJoinType,
        },
      });
      // Discard if a newer preview was kicked off in the meantime.
      if (token !== previewToken.current) return;
      setPreviewState({ title, body: res, error: null });
    } catch (err: any) {
      if (token !== previewToken.current) return;
      setPreviewState({
        title,
        body: null,
        error: err?.message ?? "Failed to compute preview",
      });
    }
  }

  function previewSuggestion(s: JoinSuggestion) {
    return runPreview(`${s.leftDatasetName} ⨝ ${s.rightDatasetName}`, {
      leftDatasetId: s.leftDatasetId,
      rightDatasetId: s.rightDatasetId,
      leftColumn: s.leftColumn,
      rightColumn: s.rightColumn,
      joinType: s.recommendedJoinType,
    });
  }

  function previewExistingJoin(j: Join) {
    const left = findDataset(datasets, j.leftDatasetId);
    const right = findDataset(datasets, j.rightDatasetId);
    return runPreview(
      `${left?.fileName ?? "left"} ⨝ ${right?.fileName ?? "right"}`,
      {
        leftDatasetId: j.leftDatasetId,
        rightDatasetId: j.rightDatasetId,
        leftColumn: j.leftColumn,
        rightColumn: j.rightColumn,
        joinType: j.joinType,
      },
    );
  }

  if (dsLoading || sLoading || jLoading || pLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!datasets || datasets.length < 2) {
    return (
      <Card>
        <CardContent className="py-12 flex flex-col items-center text-center gap-2 text-muted-foreground">
          <GitMerge className="w-7 h-7 opacity-50" />
          <p className="text-sm font-medium text-foreground">
            Upload at least two datasets to discover joins
          </p>
          <p className="text-xs max-w-md">
            Add files on the Files tab. Once two or more datasets exist, the studio will surface
            suggested joins between them.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Filter out suggestions that match a persisted join
  const liveSuggestions = suggestions.filter((s) => !isAlreadyPersisted(s));

  return (
    <div className="space-y-6" data-testid="join-studio">
      {/* Datasets summary */}
      <section>
        <h3 className="text-sm font-semibold mb-2 text-foreground">Datasets in this workspace</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {datasets.map((d) => (
            <DatasetSummaryCard key={d.id} dataset={d} />
          ))}
        </div>
      </section>

      {/* Suggested joins */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-foreground">Suggested joins</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowManual(true)}
            data-testid="button-add-manual-join"
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add join manually
          </Button>
        </div>
        {liveSuggestions.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No new join suggestions. Either no overlapping keys were found or all suggestions are
              already saved below.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {liveSuggestions.map((s, i) => (
              <Card key={i} data-testid={`suggestion-card-${i}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <span className="truncate">{s.leftDatasetName}</span>
                    <GitMerge className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="truncate">{s.rightDatasetName}</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    on{" "}
                    <code className="px-1 py-0.5 rounded bg-muted text-foreground">
                      {s.leftColumn}
                    </code>{" "}
                    ={" "}
                    <code className="px-1 py-0.5 rounded bg-muted text-foreground">
                      {s.rightColumn}
                    </code>
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={confidenceTone(s.confidence)}>
                      Confidence {pct(s.confidence)}
                    </Badge>
                    <Badge variant="outline">Match rate {pct(s.matchRate)}</Badge>
                    <Badge variant="outline">{s.unmatchedCount.toLocaleString()} unmatched</Badge>
                    <Badge variant="secondary">{s.recommendedJoinType} join</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{s.reason}</p>
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => acceptSuggestion(s)}
                      disabled={createJoin.isPending}
                      data-testid={`button-accept-${i}`}
                    >
                      <Check className="w-3.5 h-3.5 mr-1" /> Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setModifyTarget({ kind: "suggestion", suggestion: s })}
                    >
                      <Pencil className="w-3.5 h-3.5 mr-1" /> Modify
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => rejectSuggestion(s)}
                      disabled={createJoin.isPending}
                    >
                      <X className="w-3.5 h-3.5 mr-1" /> Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => previewSuggestion(s)}
                      disabled={previewJoin.isPending}
                    >
                      <Eye className="w-3.5 h-3.5 mr-1" /> Preview
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Saved joins */}
      <section>
        <h3 className="text-sm font-semibold mb-2 text-foreground">Saved joins</h3>
        {joinList.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No joins saved yet. Accept a suggestion above to get started.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {joinList.map((j) => {
              const left = findDataset(datasets, j.leftDatasetId);
              const right = findDataset(datasets, j.rightDatasetId);
              return (
                <Card key={j.id} data-testid={`join-row-${j.id}`}>
                  <CardContent className="p-3 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-sm font-medium truncate">
                        {left?.fileName ?? `dataset ${j.leftDatasetId}`}
                      </span>
                      <GitMerge className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium truncate">
                        {right?.fileName ?? `dataset ${j.rightDatasetId}`}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <code className="px-1 py-0.5 rounded bg-muted text-foreground">
                        {j.leftColumn}
                      </code>{" "}
                      ={" "}
                      <code className="px-1 py-0.5 rounded bg-muted text-foreground">
                        {j.rightColumn}
                      </code>
                    </div>
                    <Badge variant="secondary" className="capitalize">
                      {j.joinType}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={
                        j.status === "accepted"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : j.status === "rejected"
                            ? "bg-red-50 text-red-700 border-red-200"
                            : ""
                      }
                    >
                      {j.status}
                    </Badge>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => previewExistingJoin(j)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setModifyTarget({ kind: "join", join: j })}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteJoin.mutate({ workspaceId, joinId: j.id })}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Prepared datasets */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-foreground">Prepared datasets</h3>
          <Button
            size="sm"
            onClick={() => setShowPrepared(true)}
            disabled={acceptedJoins.length === 0}
            data-testid="button-create-prepared"
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Create prepared dataset
          </Button>
        </div>
        {preparedList.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No prepared datasets yet. Accept some joins above and click{" "}
              <span className="font-medium text-foreground">Create prepared dataset</span> to make a
              reusable joined view.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {preparedList.map((pd) => (
              <PreparedDatasetRow
                key={pd.id}
                pd={pd}
                expanded={openLineage === pd.id}
                onToggle={() => setOpenLineage(openLineage === pd.id ? null : pd.id)}
                onDelete={() =>
                  deletePrepared.mutate({ workspaceId, preparedDatasetId: pd.id })
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* Modify dialog */}
      <ModifyJoinDialog
        target={modifyTarget}
        onClose={() => setModifyTarget(null)}
        onSubmit={async (joinType, leftColumn, rightColumn) => {
          if (!modifyTarget) return;
          if (modifyTarget.kind === "suggestion") {
            const s = modifyTarget.suggestion;
            await createJoin.mutateAsync({
              id: workspaceId,
              data: {
                leftDatasetId: s.leftDatasetId,
                rightDatasetId: s.rightDatasetId,
                leftColumn,
                rightColumn,
                joinType,
                status: "accepted",
                confidence: s.confidence,
                matchRate: s.matchRate,
                unmatchedCount: s.unmatchedCount,
                source: "user",
              },
            });
          } else {
            await updateJoin.mutateAsync({
              workspaceId,
              joinId: modifyTarget.join.id,
              data: { joinType, leftColumn, rightColumn, status: "accepted" },
            });
          }
          setModifyTarget(null);
        }}
        datasets={datasets}
      />

      {/* Manual add dialog */}
      <ManualJoinDialog
        open={showManual}
        onOpenChange={setShowManual}
        datasets={datasets}
        onSubmit={async (leftDatasetId, rightDatasetId, leftColumn, rightColumn, joinType) => {
          await createJoin.mutateAsync({
            id: workspaceId,
            data: {
              leftDatasetId,
              rightDatasetId,
              leftColumn,
              rightColumn,
              joinType,
              status: "accepted",
              source: "user",
            },
          });
          setShowManual(false);
        }}
      />

      {/* Create prepared dataset dialog */}
      <CreatePreparedDialog
        open={showPrepared}
        onOpenChange={(o) => {
          setShowPrepared(o);
          if (!o) setPreparedSeed(null);
        }}
        datasets={datasets}
        joins={acceptedJoins}
        seed={preparedSeed}
        onSubmit={async (name, description, baseDatasetId, joinIds) => {
          const created = await createPrepared.mutateAsync({
            id: workspaceId,
            data: { name, description: description || null, baseDatasetId, joinIds },
          });
          setShowPrepared(false);
          setPreparedSeed(null);
          if (created?.id) {
            // Auto-suggest a starter set of metrics for the new prepared dataset.
            // Best-effort: surface failures via the suggestMetrics mutation state.
            void suggestMetrics
              .mutateAsync({
                id: workspaceId,
                data: { preparedDatasetId: created.id },
              })
              .catch(() => {
                /* non-fatal — user can re-trigger from the Metrics tab */
              });
          }
        }}
      />

      {/* Preview drawer */}
      <Sheet open={!!previewState} onOpenChange={(o) => !o && setPreviewState(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-auto">
          <SheetHeader>
            <SheetTitle>Preview · {previewState?.title}</SheetTitle>
            <SheetDescription>
              First 20 joined rows (computed without saving).
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            {previewState?.error ? (
              <div
                className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                data-testid="preview-error"
              >
                {previewState.error}
              </div>
            ) : !previewState?.body ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Computing…
              </div>
            ) : previewState.body.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matching rows for this join.</p>
            ) : (
              <div className="overflow-auto border rounded">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      {previewState.body.columns.map((c) => (
                        <th key={c} className="text-left p-2 font-medium whitespace-nowrap">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewState.body.rows.map((r, i) => (
                      <tr key={i} className="border-t">
                        {previewState.body!.columns.map((c) => (
                          <td key={c} className="p-2 align-top whitespace-nowrap">
                            {r[c] === null || r[c] === undefined ? (
                              <span className="text-muted-foreground italic">null</span>
                            ) : (
                              String(r[c])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="p-2 text-[11px] text-muted-foreground">
                  Showing {previewState.body.rows.length} of {previewState.body.totalRows} matched rows
                </p>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PreparedDatasetRow({
  pd,
  expanded,
  onToggle,
  onDelete,
}: {
  pd: PreparedDataset;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const breadcrumb = useMemo(() => {
    const parts = [pd.lineage.baseFile];
    for (const step of pd.lineage.steps) {
      parts.push(`⨝ ${step.rightFile} on ${step.leftColumn}=${step.rightColumn}`);
    }
    return parts.join("  ");
  }, [pd]);

  return (
    <Card data-testid={`prepared-row-${pd.id}`}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{pd.name}</p>
            <p className="text-xs text-muted-foreground truncate">{breadcrumb}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={onToggle}>
              {expanded ? "Hide lineage" : "Show lineage"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        {expanded && (
          <div className="border rounded p-2 bg-muted/30 text-xs space-y-1">
            <p>
              <span className="text-muted-foreground">Base:</span>{" "}
              <span className="font-medium">{pd.lineage.baseFile}</span>
            </p>
            {pd.lineage.steps.length === 0 ? (
              <p className="text-muted-foreground">No joins applied (base only).</p>
            ) : (
              <ol className="list-decimal pl-5 space-y-0.5">
                {pd.lineage.steps.map((s, i) => (
                  <li key={i}>
                    <code className="text-foreground">{s.leftFile}</code>{" "}
                    <span className="text-muted-foreground">{s.joinType} ⨝</span>{" "}
                    <code className="text-foreground">{s.rightFile}</code> on{" "}
                    <code>{s.leftColumn}</code>=<code>{s.rightColumn}</code>
                  </li>
                ))}
              </ol>
            )}
            {pd.description && (
              <p className="pt-1 text-muted-foreground">{pd.description}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ModifyJoinDialog({
  target,
  onClose,
  onSubmit,
  datasets,
}: {
  target:
    | { kind: "suggestion"; suggestion: JoinSuggestion }
    | { kind: "join"; join: Join }
    | null;
  onClose: () => void;
  onSubmit: (
    joinType: "inner" | "left" | "right" | "outer",
    leftColumn: string,
    rightColumn: string,
  ) => Promise<void>;
  datasets: Dataset[] | undefined;
}) {
  const [joinType, setJoinType] = useState<"inner" | "left" | "right" | "outer">("inner");
  const [leftCol, setLeftCol] = useState("");
  const [rightCol, setRightCol] = useState("");

  const open = !!target;

  // Reset on open
  useMemo(() => {
    if (target?.kind === "suggestion") {
      setJoinType(target.suggestion.recommendedJoinType);
      setLeftCol(target.suggestion.leftColumn);
      setRightCol(target.suggestion.rightColumn);
    } else if (target?.kind === "join") {
      setJoinType(target.join.joinType);
      setLeftCol(target.join.leftColumn);
      setRightCol(target.join.rightColumn);
    }
  }, [target]);

  const leftId =
    target?.kind === "suggestion" ? target.suggestion.leftDatasetId : target?.join.leftDatasetId;
  const rightId =
    target?.kind === "suggestion" ? target.suggestion.rightDatasetId : target?.join.rightDatasetId;
  const leftDs = datasets?.find((d) => d.id === leftId);
  const rightDs = datasets?.find((d) => d.id === rightId);
  const { data: leftDetail } = useGetDataset(leftId ?? 0, {
    query: { queryKey: getGetDatasetQueryKey(leftId ?? 0), enabled: open && leftId !== undefined },
  });
  const { data: rightDetail } = useGetDataset(rightId ?? 0, {
    query: { queryKey: getGetDatasetQueryKey(rightId ?? 0), enabled: open && rightId !== undefined },
  });
  const leftCols = (leftDetail?.columns ?? []).map((c) => c.name);
  const rightCols = (rightDetail?.columns ?? []).map((c) => c.name);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Modify join</DialogTitle>
          <DialogDescription>
            Change the join type or swap key columns to refine the match.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Left key ({leftDs?.fileName ?? "left"})</Label>
              <Select value={leftCol} onValueChange={setLeftCol}>
                <SelectTrigger data-testid="select-left-col">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {leftCols.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Right key ({rightDs?.fileName ?? "right"})</Label>
              <Select value={rightCol} onValueChange={setRightCol}>
                <SelectTrigger data-testid="select-right-col">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {rightCols.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Join type</Label>
            <Select value={joinType} onValueChange={(v) => setJoinType(v as typeof joinType)}>
              <SelectTrigger data-testid="select-join-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inner">inner</SelectItem>
                <SelectItem value="left">left</SelectItem>
                <SelectItem value="right">right</SelectItem>
                <SelectItem value="outer">outer</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit(joinType, leftCol, rightCol)}
            data-testid="button-save-modify"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManualJoinDialog({
  open,
  onOpenChange,
  datasets,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  datasets: Dataset[];
  onSubmit: (
    leftId: number,
    rightId: number,
    leftCol: string,
    rightCol: string,
    joinType: "inner" | "left" | "right" | "outer",
  ) => Promise<void>;
}) {
  const [leftId, setLeftId] = useState<number | null>(null);
  const [rightId, setRightId] = useState<number | null>(null);
  const [leftCol, setLeftCol] = useState("");
  const [rightCol, setRightCol] = useState("");
  const [joinType, setJoinType] = useState<"inner" | "left" | "right" | "outer">("inner");

  const leftDs = datasets.find((d) => d.id === leftId);
  const rightDs = datasets.find((d) => d.id === rightId);
  const { data: leftDetail } = useGetDataset(leftId ?? 0, {
    query: { queryKey: getGetDatasetQueryKey(leftId ?? 0), enabled: open && leftId !== null },
  });
  const { data: rightDetail } = useGetDataset(rightId ?? 0, {
    query: { queryKey: getGetDatasetQueryKey(rightId ?? 0), enabled: open && rightId !== null },
  });

  const valid =
    leftId !== null && rightId !== null && leftId !== rightId && leftCol && rightCol;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add join manually</DialogTitle>
          <DialogDescription>
            Pick two datasets and the keys that link them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Left dataset</Label>
              <Select
                value={leftId?.toString() ?? ""}
                onValueChange={(v) => {
                  setLeftId(Number(v));
                  setLeftCol("");
                }}
              >
                <SelectTrigger data-testid="select-manual-left-ds">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {datasets.map((d) => (
                    <SelectItem key={d.id} value={d.id.toString()}>
                      {d.fileName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Right dataset</Label>
              <Select
                value={rightId?.toString() ?? ""}
                onValueChange={(v) => {
                  setRightId(Number(v));
                  setRightCol("");
                }}
              >
                <SelectTrigger data-testid="select-manual-right-ds">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {datasets.map((d) => (
                    <SelectItem key={d.id} value={d.id.toString()}>
                      {d.fileName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Left key</Label>
              <Select value={leftCol} onValueChange={setLeftCol} disabled={!leftDs}>
                <SelectTrigger data-testid="select-manual-left-col">
                  <SelectValue placeholder="…" />
                </SelectTrigger>
                <SelectContent>
                  {(leftDetail?.columns ?? []).map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Right key</Label>
              <Select value={rightCol} onValueChange={setRightCol} disabled={!rightDs}>
                <SelectTrigger data-testid="select-manual-right-col">
                  <SelectValue placeholder="…" />
                </SelectTrigger>
                <SelectContent>
                  {(rightDetail?.columns ?? []).map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Join type</Label>
            <Select value={joinType} onValueChange={(v) => setJoinType(v as typeof joinType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inner">inner</SelectItem>
                <SelectItem value="left">left</SelectItem>
                <SelectItem value="right">right</SelectItem>
                <SelectItem value="outer">outer</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              valid && onSubmit(leftId!, rightId!, leftCol, rightCol, joinType)
            }
            disabled={!valid}
            data-testid="button-save-manual-join"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreatePreparedDialog({
  open,
  onOpenChange,
  datasets,
  joins,
  seed,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  datasets: Dataset[];
  joins: Join[];
  seed?: { name: string; baseDatasetId: number; joinIds: number[] } | null;
  onSubmit: (
    name: string,
    description: string,
    baseDatasetId: number,
    joinIds: number[],
  ) => Promise<void>;
}) {
  const [name, setName] = useState(seed?.name ?? "");
  const [description, setDescription] = useState("");
  const [baseId, setBaseId] = useState<number | null>(seed?.baseDatasetId ?? null);
  const [selectedJoins, setSelectedJoins] = useState<Set<number>>(
    () => new Set(seed?.joinIds ?? []),
  );

  // When the dialog (re)opens with a fresh seed, reset the form so each
  // Accept-driven prompt starts from sensible defaults.
  useEffect(() => {
    if (!open) return;
    setName(seed?.name ?? "");
    setDescription("");
    setBaseId(seed?.baseDatasetId ?? null);
    setSelectedJoins(new Set(seed?.joinIds ?? []));
  }, [open, seed]);

  // Derive which datasets appear in any accepted join (eligible bases)
  const baseCandidates = useMemo(() => {
    const ids = new Set<number>();
    for (const j of joins) {
      ids.add(j.leftDatasetId);
      ids.add(j.rightDatasetId);
    }
    return datasets.filter((d) => ids.has(d.id));
  }, [datasets, joins]);

  // Eligible joins: those that touch a chain reachable from base
  const eligibleJoins = useMemo(() => {
    if (baseId === null) return [];
    const reachable = new Set<number>([baseId]);
    let added = true;
    const remaining = [...joins];
    while (added) {
      added = false;
      for (let i = remaining.length - 1; i >= 0; i--) {
        const j = remaining[i];
        if (reachable.has(j.leftDatasetId) || reachable.has(j.rightDatasetId)) {
          reachable.add(j.leftDatasetId);
          reachable.add(j.rightDatasetId);
          remaining.splice(i, 1);
          added = true;
        }
      }
    }
    return joins.filter(
      (j) => reachable.has(j.leftDatasetId) && reachable.has(j.rightDatasetId),
    );
  }, [baseId, joins]);

  function toggle(id: number) {
    setSelectedJoins((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const valid = name.trim() && baseId !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create prepared dataset</DialogTitle>
          <DialogDescription>
            Pick a base dataset and the joins to apply on top of it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Customers + Policies"
              data-testid="input-prepared-name"
            />
          </div>
          <div>
            <Label className="text-xs">Description (optional)</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this prepared dataset is for…"
            />
          </div>
          <div>
            <Label className="text-xs">Base dataset</Label>
            <Select
              value={baseId?.toString() ?? ""}
              onValueChange={(v) => {
                setBaseId(Number(v));
                setSelectedJoins(new Set());
              }}
            >
              <SelectTrigger data-testid="select-prepared-base">
                <SelectValue placeholder="Select base…" />
              </SelectTrigger>
              <SelectContent>
                {baseCandidates.map((d) => (
                  <SelectItem key={d.id} value={d.id.toString()}>
                    {d.fileName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {baseId !== null && (
            <div>
              <Label className="text-xs">Joins to apply</Label>
              <div className="border rounded p-2 space-y-1 max-h-48 overflow-auto">
                {eligibleJoins.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No accepted joins reachable from this base.
                  </p>
                ) : (
                  eligibleJoins.map((j) => {
                    const left = datasets.find((d) => d.id === j.leftDatasetId);
                    const right = datasets.find((d) => d.id === j.rightDatasetId);
                    return (
                      <label
                        key={j.id}
                        className="flex items-center gap-2 text-xs cursor-pointer"
                        data-testid={`checkbox-join-${j.id}`}
                      >
                        <Checkbox
                          checked={selectedJoins.has(j.id)}
                          onCheckedChange={() => toggle(j.id)}
                        />
                        <span className="truncate">
                          {left?.fileName} ⨝ {right?.fileName} on {j.leftColumn}={j.rightColumn}
                          <span className="ml-1 text-muted-foreground">({j.joinType})</span>
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              valid && onSubmit(name.trim(), description, baseId!, [...selectedJoins])
            }
            disabled={!valid}
            data-testid="button-save-prepared"
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DatasetSummaryCard({ dataset }: { dataset: Dataset }) {
  const { data: detail } = useGetDataset(dataset.id);
  const cols = detail?.columns ?? [];
  const colCount = cols.length;
  const detectedKeys = useMemo(() => {
    if (!cols.length || !detail?.rowCount) return [] as string[];
    return cols
      .filter((c) => {
        const unique = c.uniqueCount ?? 0;
        const rows = detail.rowCount ?? 0;
        return rows > 0 && unique / rows > 0.95;
      })
      .map((c) => c.name)
      .slice(0, 4);
  }, [cols, detail?.rowCount]);

  return (
    <Card data-testid={`dataset-card-${dataset.id}`}>
      <CardContent className="p-4 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium truncate" title={dataset.fileName}>
            {dataset.fileName}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {dataset.rowCount?.toLocaleString() ?? "—"} rows
          {colCount ? ` · ${colCount} cols` : ""}
          {dataset.issueCount ? ` · ${dataset.issueCount} issues` : ""}
        </div>
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          <Badge variant="outline" className="text-[10px]">
            Readiness {dataset.readinessScore ?? 0}
          </Badge>
          {detectedKeys.length > 0 && (
            <span
              className="text-[10px] text-muted-foreground"
              data-testid={`detected-keys-${dataset.id}`}
            >
              keys: {detectedKeys.join(", ")}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
