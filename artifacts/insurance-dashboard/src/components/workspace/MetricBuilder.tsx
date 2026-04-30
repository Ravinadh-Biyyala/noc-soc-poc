import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMetrics,
  useCreateMetric,
  useUpdateMetric,
  useDeleteMetric,
  useSuggestMetrics,
  useListPreparedDatasets,
  getListMetricsQueryKey,
  type Metric,
  type PreparedDataset,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
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
  Sparkles,
  Plus,
  Save,
  Check,
  Award,
  X,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
} from "lucide-react";

interface MetricBuilderProps {
  workspaceId: number;
}

const STATUS_TONE: Record<string, string> = {
  ai_suggested: "bg-blue-50 text-blue-700 border-blue-200",
  user_approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  certified: "bg-purple-50 text-purple-700 border-purple-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

const STATUS_LABEL: Record<string, string> = {
  ai_suggested: "AI suggested",
  user_approved: "Approved",
  certified: "Certified",
  rejected: "Rejected",
};

export default function MetricBuilder({ workspaceId }: MetricBuilderProps) {
  const queryClient = useQueryClient();

  const { data: metrics, isLoading } = useListMetrics(workspaceId);
  const { data: prepared } = useListPreparedDatasets(workspaceId);

  const list = metrics ?? [];
  const preparedList = prepared ?? [];

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListMetricsQueryKey(workspaceId) });

  const createMetric = useCreateMetric({ mutation: { onSuccess: invalidate } });
  const updateMetric = useUpdateMetric({ mutation: { onSuccess: invalidate } });
  const deleteMetric = useDeleteMetric({ mutation: { onSuccess: invalidate } });
  const suggestMetrics = useSuggestMetrics({ mutation: { onSuccess: invalidate } });

  const [showSuggest, setShowSuggest] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  async function runSuggest(preparedDatasetId: number) {
    setSuggestError(null);
    try {
      await suggestMetrics.mutateAsync({
        id: workspaceId,
        data: { preparedDatasetId },
      });
      setShowSuggest(false);
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : "Suggestion failed");
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="metric-builder">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Metrics</h3>
          <p className="text-xs text-muted-foreground">
            Define KPIs once. Approved and certified metrics appear in dashboard generation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSuggest(true)}
            disabled={preparedList.length === 0}
            data-testid="button-suggest-metrics"
          >
            <Sparkles className="w-3.5 h-3.5 mr-1" /> Suggest with AI
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-metric">
            <Plus className="w-3.5 h-3.5 mr-1" /> New metric
          </Button>
        </div>
      </div>

      {preparedList.length === 0 && (
        <Card>
          <CardContent className="p-3 text-xs text-muted-foreground flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Build a prepared dataset on the Prepared tab to enable AI metric suggestions.
          </CardContent>
        </Card>
      )}

      {list.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No metrics yet. Click <span className="font-medium text-foreground">Suggest with AI</span>{" "}
            or <span className="font-medium text-foreground">New metric</span> to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {list.map((m) => (
            <MetricRow
              key={m.id}
              metric={m}
              preparedList={preparedList}
              onSave={(patch) =>
                updateMetric.mutateAsync({ workspaceId, metricId: m.id, data: patch })
              }
              onDelete={() =>
                deleteMetric.mutate({ workspaceId, metricId: m.id })
              }
              busy={updateMetric.isPending || deleteMetric.isPending}
            />
          ))}
        </div>
      )}

      <SuggestDialog
        open={showSuggest}
        onOpenChange={(o) => {
          setShowSuggest(o);
          if (!o) setSuggestError(null);
        }}
        prepared={preparedList}
        onSubmit={runSuggest}
        busy={suggestMetrics.isPending}
        error={suggestError}
      />

      <CreateMetricDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        prepared={preparedList}
        onSubmit={async (body) => {
          await createMetric.mutateAsync({ id: workspaceId, data: body });
          setShowCreate(false);
        }}
      />
    </div>
  );
}

function MetricRow({
  metric,
  preparedList,
  onSave,
  onDelete,
  busy,
}: {
  metric: Metric;
  preparedList: PreparedDataset[];
  onSave: (patch: {
    name?: string;
    formula?: string;
    description?: string | null;
    format?: "number" | "currency" | "percent";
    status?: "ai_suggested" | "user_approved" | "certified" | "rejected";
    owner?: string;
    note?: string;
  }) => Promise<unknown>;
  onDelete: () => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [name, setName] = useState(metric.name);
  const [formula, setFormula] = useState(metric.formula);
  const [description, setDescription] = useState(metric.description ?? "");
  const [format, setFormat] = useState<"number" | "currency" | "percent">(metric.format);
  const [owner, setOwner] = useState(metric.owner);
  const [note, setNote] = useState("");

  const dirty =
    name !== metric.name ||
    formula !== metric.formula ||
    (description ?? "") !== (metric.description ?? "") ||
    format !== metric.format ||
    owner !== metric.owner;

  const preparedName = useMemo(
    () =>
      metric.preparedDatasetId
        ? preparedList.find((p) => p.id === metric.preparedDatasetId)?.name
        : null,
    [metric.preparedDatasetId, preparedList],
  );

  return (
    <Card data-testid={`metric-row-${metric.id}`}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            className="flex items-center gap-2 text-left min-w-0 flex-1 hover:opacity-80"
            onClick={() => setOpen(!open)}
          >
            {open ? (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium truncate">{metric.name}</span>
                <Badge variant="outline" className={STATUS_TONE[metric.status]}>
                  {STATUS_LABEL[metric.status] ?? metric.status}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  {metric.format}
                </Badge>
                {metric.source === "ai" && (
                  <Badge variant="outline" className="text-[10px]">
                    <Sparkles className="w-2.5 h-2.5 mr-0.5" /> AI
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">
                <code className="font-mono">{metric.formula}</code>
                {preparedName ? <span className="ml-2">on {preparedName}</span> : null}
              </p>
            </div>
          </button>
          <div className="flex items-center gap-1">
            {metric.status !== "user_approved" && metric.status !== "certified" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSave({ status: "user_approved", note: "Approved" })}
                disabled={busy}
                data-testid={`button-approve-${metric.id}`}
              >
                <Check className="w-3.5 h-3.5 mr-1" /> Approve
              </Button>
            )}
            {metric.status !== "certified" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSave({ status: "certified", note: "Certified" })}
                disabled={busy}
                data-testid={`button-certify-${metric.id}`}
              >
                <Award className="w-3.5 h-3.5 mr-1" /> Certify
              </Button>
            )}
            {metric.status !== "rejected" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onSave({ status: "rejected", note: "Rejected" })}
                disabled={busy}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onDelete} disabled={busy}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {open && (
          <div className="border-t pt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-testid={`input-name-${metric.id}`}
                />
              </div>
              <div>
                <Label className="text-xs">Owner</Label>
                <Input value={owner} onChange={(e) => setOwner(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Formula</Label>
              <Textarea
                rows={2}
                value={formula}
                onChange={(e) => setFormula(e.target.value)}
                className="font-mono text-xs"
                data-testid={`input-formula-${metric.id}`}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Use SUM, AVG, COUNT, COUNT_DISTINCT, MIN, MAX, RATIO, or arithmetic over column
                names.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Format</Label>
                <Select value={format} onValueChange={(v) => setFormat(v as typeof format)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="number">number</SelectItem>
                    <SelectItem value="currency">currency</SelectItem>
                    <SelectItem value="percent">percent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Note (saved to audit log)</Label>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Why this change?"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 justify-end">
              <Button
                size="sm"
                onClick={async () => {
                  await onSave({
                    name,
                    formula,
                    description: description || null,
                    format,
                    owner,
                    note: note || undefined,
                  });
                  setNote("");
                }}
                disabled={!dirty || busy}
                data-testid={`button-save-${metric.id}`}
              >
                <Save className="w-3.5 h-3.5 mr-1" /> Save changes
              </Button>
            </div>

            {/* Audit log */}
            <div className="border-t pt-2">
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setAuditOpen(!auditOpen)}
              >
                {auditOpen ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                Audit log ({metric.auditLog.length})
              </button>
              {auditOpen && (
                <div className="mt-2 space-y-1 max-h-40 overflow-auto">
                  {metric.auditLog.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No history yet.</p>
                  ) : (
                    [...metric.auditLog].reverse().map((entry, i) => (
                      <div
                        key={i}
                        className="text-[11px] border-l-2 border-muted pl-2 text-muted-foreground"
                      >
                        <span className="font-medium text-foreground">{entry.action}</span>
                        {" by "}
                        {entry.by}
                        {" · "}
                        {new Date(entry.at).toLocaleString()}
                        {entry.note ? <span className="block">{entry.note}</span> : null}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SuggestDialog({
  open,
  onOpenChange,
  prepared,
  onSubmit,
  busy,
  error,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prepared: PreparedDataset[];
  onSubmit: (preparedId: number) => void;
  busy: boolean;
  error: string | null;
}) {
  const [pid, setPid] = useState<number | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Suggest metrics with AI</DialogTitle>
          <DialogDescription>
            Pick a prepared dataset; the model will propose KPIs based on its columns.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label className="text-xs">Prepared dataset</Label>
          <Select
            value={pid?.toString() ?? ""}
            onValueChange={(v) => setPid(Number(v))}
          >
            <SelectTrigger data-testid="select-suggest-prepared">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {prepared.map((p) => (
                <SelectItem key={p.id} value={p.id.toString()}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => pid !== null && onSubmit(pid)}
            disabled={pid === null || busy}
            data-testid="button-run-suggest"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}
            Suggest
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateMetricDialog({
  open,
  onOpenChange,
  prepared,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prepared: PreparedDataset[];
  onSubmit: (body: {
    name: string;
    formula: string;
    description: string | null;
    format: "number" | "currency" | "percent";
    owner: string;
    source: "user";
    preparedDatasetId: number | null;
  }) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [formula, setFormula] = useState("");
  const [description, setDescription] = useState("");
  const [format, setFormat] = useState<"number" | "currency" | "percent">("number");
  const [owner, setOwner] = useState("You");
  const [preparedId, setPreparedId] = useState<number | null>(null);

  const valid = name.trim() && formula.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New metric</DialogTitle>
          <DialogDescription>
            Define a KPI with a formula. It will start in the AI suggested state until approved.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Total Premium"
              data-testid="input-new-name"
            />
          </div>
          <div>
            <Label className="text-xs">Formula</Label>
            <Textarea
              rows={2}
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder="SUM(premium)"
              className="font-mono text-xs"
              data-testid="input-new-formula"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Format</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as typeof format)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="number">number</SelectItem>
                  <SelectItem value="currency">currency</SelectItem>
                  <SelectItem value="percent">percent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Owner</Label>
              <Input value={owner} onChange={(e) => setOwner(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Prepared dataset (optional)</Label>
            <Select
              value={preparedId?.toString() ?? "none"}
              onValueChange={(v) => setPreparedId(v === "none" ? null : Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {prepared.map((p) => (
                  <SelectItem key={p.id} value={p.id.toString()}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              valid &&
              onSubmit({
                name: name.trim(),
                formula: formula.trim(),
                description: description || null,
                format,
                owner,
                source: "user",
                preparedDatasetId: preparedId,
              })
            }
            disabled={!valid}
            data-testid="button-save-new-metric"
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
