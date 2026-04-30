import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateDatasetColumn,
  getGetDatasetQueryKey,
  getListWorkspaceDatasetsQueryKey,
  getGetWorkspaceQueryKey,
  type DatasetDetail,
  type DatasetColumn,
  type UpdateDatasetColumnBodySemanticType,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

const SEMANTIC_TYPES = [
  { value: "date", label: "Date", tone: "bg-sky-50 text-sky-700 border-sky-200" },
  { value: "currency", label: "Currency", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { value: "percent", label: "Percent", tone: "bg-violet-50 text-violet-700 border-violet-200" },
  { value: "id", label: "ID", tone: "bg-slate-100 text-slate-700 border-slate-200" },
  { value: "category", label: "Category", tone: "bg-amber-50 text-amber-700 border-amber-200" },
  { value: "measure", label: "Measure", tone: "bg-blue-50 text-blue-700 border-blue-200" },
  { value: "boolean", label: "Boolean", tone: "bg-pink-50 text-pink-700 border-pink-200" },
  { value: "text", label: "Text", tone: "bg-muted text-muted-foreground border-border" },
] as const;

function toneFor(value: string): string {
  return SEMANTIC_TYPES.find((s) => s.value === value)?.tone ?? "bg-muted text-muted-foreground border-border";
}

function labelFor(value: string): string {
  return SEMANTIC_TYPES.find((s) => s.value === value)?.label ?? value;
}

interface UnderstandingViewProps {
  dataset: DatasetDetail;
}

const AGG_LABEL: Record<string, string> = {
  sum: "Sum",
  avg: "Average",
  count: "Count",
  count_distinct: "Unique count",
  min: "Min",
  max: "Max",
};

export default function UnderstandingView({ dataset }: UnderstandingViewProps) {
  const kpis = dataset.suggestedKpis ?? [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Rows" value={dataset.rowCount.toLocaleString()} />
        <Stat label="Columns" value={String(dataset.columns.length)} />
        <Stat label="Sampled rows" value={dataset.returnedRowCount.toLocaleString()} />
        <Stat label="Readiness" value={`${dataset.readinessScore}%`} />
      </div>

      {kpis.length > 0 && (
        <Card data-testid="suggested-kpis">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">AI-suggested KPIs</CardTitle>
            <CardDescription className="text-xs">
              Starter metrics Gen-BI inferred from your column types — these will seed the dashboards in the next step.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {kpis.map((kpi) => (
                <div
                  key={kpi.id}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 pl-2 pr-3 py-1"
                  data-testid={`suggested-kpi-${kpi.id}`}
                  title={kpi.reason}
                >
                  <Badge
                    variant="outline"
                    className="text-[10px] font-normal bg-primary/10 text-primary border-primary/20"
                  >
                    {AGG_LABEL[kpi.agg] ?? kpi.agg}
                  </Badge>
                  <span className="text-xs font-medium">{kpi.label}</span>
                  {kpi.column !== "*" && (
                    <span className="text-[10px] text-muted-foreground">· {kpi.column}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Columns &amp; meaning</CardTitle>
          <CardDescription className="text-xs">
            Gen-BI inferred a semantic type and business meaning for every column. Override anything that looks off — your
            choices are persisted and used by downstream metrics.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[28%]">Column</TableHead>
                <TableHead className="w-[16%]">Type</TableHead>
                <TableHead className="w-[26%]">Business meaning</TableHead>
                <TableHead className="w-[10%] text-right">Unique</TableHead>
                <TableHead className="w-[10%] text-right">Missing</TableHead>
                <TableHead>Sample</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dataset.columns.map((col) => (
                <ColumnRow key={col.id} column={col} dataset={dataset} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Sample rows</CardTitle>
          <CardDescription className="text-xs">First {dataset.sampleRows.length} rows from the file.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {dataset.columns.map((c) => (
                  <TableHead key={c.id} className="whitespace-nowrap">
                    {c.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {dataset.sampleRows.map((row, i) => (
                <TableRow key={i}>
                  {dataset.columns.map((c) => (
                    <TableCell key={c.id} className="text-xs whitespace-nowrap max-w-[12rem] truncate">
                      {formatCell((row as Record<string, unknown>)[c.name])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
        <p className="text-xl font-bold mt-0.5">{value}</p>
      </CardContent>
    </Card>
  );
}

function ColumnRow({ column, dataset }: { column: DatasetColumn; dataset: DatasetDetail }) {
  const queryClient = useQueryClient();
  const [meaning, setMeaning] = useState(column.businessMeaning ?? "");
  const [savedMeaning, setSavedMeaning] = useState(column.businessMeaning ?? "");

  // If the underlying record changes (e.g. after a fresh fetch with overrides
  // applied), keep the local input in sync.
  useEffect(() => {
    setMeaning(column.businessMeaning ?? "");
    setSavedMeaning(column.businessMeaning ?? "");
  }, [column.id, column.businessMeaning]);

  const mutation = useUpdateDatasetColumn({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getGetDatasetQueryKey(dataset.id) });
        await queryClient.invalidateQueries({ queryKey: getListWorkspaceDatasetsQueryKey(dataset.workspaceId) });
        await queryClient.invalidateQueries({ queryKey: getGetWorkspaceQueryKey(dataset.workspaceId) });
      },
    },
  });

  const onTypeChange = (value: string) => {
    mutation.mutate({
      datasetId: dataset.id,
      columnId: column.id,
      data: { semanticType: value as UpdateDatasetColumnBodySemanticType },
    });
  };

  const commitMeaning = () => {
    if (meaning !== savedMeaning) {
      setSavedMeaning(meaning);
      mutation.mutate({
        datasetId: dataset.id,
        columnId: column.id,
        data: { businessMeaning: meaning },
      });
    }
  };

  const missingPct = dataset.rowCount === 0 ? 0 : (column.nullCount / dataset.rowCount) * 100;

  return (
    <TableRow data-testid={`column-row-${column.id}`}>
      <TableCell className="align-top">
        <div className="font-medium text-sm flex items-center gap-1.5">
          {column.name}
          {column.overriddenSemantic && (
            <Badge variant="outline" className="text-[9px] font-normal h-4 px-1">
              edited
            </Badge>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">raw: {column.rawType}</div>
      </TableCell>
      <TableCell className="align-top">
        <Select value={column.semanticType} onValueChange={onTypeChange} disabled={mutation.isPending}>
          <SelectTrigger className="h-8 text-xs" data-testid={`column-type-${column.id}`}>
            <SelectValue>
              <Badge
                variant="outline"
                className={cn("text-[10px] font-normal", toneFor(column.semanticType))}
              >
                {labelFor(column.semanticType)}
              </Badge>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {SEMANTIC_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value} className="text-xs">
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="align-top">
        <Input
          value={meaning}
          onChange={(e) => setMeaning(e.target.value)}
          onBlur={commitMeaning}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="What does this column mean?"
          className="h-8 text-xs"
          data-testid={`column-meaning-${column.id}`}
        />
        {column.overriddenMeaning && (
          <span className="text-[10px] text-muted-foreground">customised</span>
        )}
      </TableCell>
      <TableCell className="align-top text-right tabular-nums text-xs">
        {column.uniqueCount.toLocaleString()}
      </TableCell>
      <TableCell className="align-top text-right tabular-nums text-xs">
        {column.nullCount.toLocaleString()}
        {missingPct >= 1 && (
          <div className="text-[10px] text-muted-foreground">{missingPct.toFixed(1)}%</div>
        )}
      </TableCell>
      <TableCell className="align-top text-xs text-muted-foreground max-w-[18rem]">
        <div className="flex flex-wrap gap-1">
          {column.sample.slice(0, 5).map((s, i) => (
            <span
              key={i}
              className="inline-flex max-w-[10rem] truncate rounded bg-muted/60 px-1.5 py-0.5 text-[10px]"
            >
              {formatCell(s)}
            </span>
          ))}
        </div>
      </TableCell>
    </TableRow>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
