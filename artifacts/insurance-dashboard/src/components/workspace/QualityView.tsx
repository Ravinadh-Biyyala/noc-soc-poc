import { useMemo } from "react";
import type { DatasetDetail, DatasetIssue } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Download, ArrowRight, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface QualityViewProps {
  dataset: DatasetDetail;
  workspaceId: number;
}

const CATEGORY_LABEL: Record<string, string> = {
  missing: "Missing values",
  duplicates: "Duplicate rows",
  format: "Inconsistent formats",
  outliers: "Outliers",
  invalid_date: "Invalid dates",
  empty_column: "Empty columns",
  suspicious: "Suspicious values",
};

const SEVERITY_TONE: Record<DatasetIssue["severity"], string> = {
  high: "bg-red-50 text-red-700 border-red-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-slate-50 text-slate-700 border-slate-200",
};

function scoreBand(score: number) {
  if (score >= 80) return { label: "Ready", tone: "text-emerald-700", ring: "stroke-emerald-500" };
  if (score >= 60) return { label: "Acceptable", tone: "text-amber-700", ring: "stroke-amber-500" };
  return { label: "Needs work", tone: "text-red-700", ring: "stroke-red-500" };
}

const READINESS_THRESHOLD = 60;

function buildCsv(dataset: DatasetDetail): string {
  const rows: string[][] = [["category", "severity", "column", "count", "message", "suggested_fix"]];
  for (const issue of dataset.issues) {
    rows.push([
      issue.category,
      issue.severity,
      issue.column ?? "",
      String(issue.count),
      issue.message,
      issue.suggestedFix,
    ]);
  }
  return rows
    .map((cols) =>
      cols
        .map((c) => {
          const needsQuote = /[",\n]/.test(c);
          const escaped = c.replace(/"/g, '""');
          return needsQuote ? `"${escaped}"` : escaped;
        })
        .join(","),
    )
    .join("\n");
}

function downloadCsv(dataset: DatasetDetail) {
  const csv = buildCsv(dataset);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = dataset.fileName.replace(/[^a-z0-9.-]+/gi, "_");
  a.download = `${safe}_${dataset.sheetName}_issues.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function QualityView({ dataset, workspaceId }: QualityViewProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, DatasetIssue[]>();
    for (const issue of dataset.issues) {
      const arr = map.get(issue.category) ?? [];
      arr.push(issue);
      map.set(issue.category, arr);
    }
    return Array.from(map.entries()).sort(
      ([, a], [, b]) =>
        b.reduce((s, x) => s + (x.severity === "high" ? 3 : x.severity === "medium" ? 2 : 1), 0) -
        a.reduce((s, x) => s + (x.severity === "high" ? 3 : x.severity === "medium" ? 2 : 1), 0),
    );
  }, [dataset.issues]);

  const band = scoreBand(dataset.readinessScore);
  const meetsThreshold = dataset.readinessScore >= READINESS_THRESHOLD;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5 flex flex-col md:flex-row items-start md:items-center gap-5">
          <ScoreGauge score={dataset.readinessScore} ringClassName={band.ring} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold">Data Readiness Score</p>
              <Badge variant="outline" className={cn("text-[11px]", band.tone, "border-current")}>
                {band.label}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {dataset.issues.length === 0
                ? "Looks great — no quality issues detected."
                : `${dataset.issues.length} quality issue${dataset.issues.length === 1 ? "" : "s"} detected across ${grouped.length} categor${
                    grouped.length === 1 ? "y" : "ies"
                  }. Review the table below.`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => downloadCsv(dataset)}
                disabled={dataset.issues.length === 0}
                data-testid="download-issues-csv"
              >
                <Download className="w-3.5 h-3.5 mr-1.5" /> Download issue report
              </Button>
              <Button
                size="sm"
                disabled={!meetsThreshold}
                data-testid="continue-join-studio"
                title={meetsThreshold ? "Move on to joining datasets" : "Score must be ≥ 60% to proceed"}
              >
                Continue to Join Studio <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
              {!meetsThreshold && (
                <button
                  className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  onClick={() => {
                    if (window.confirm("Continue with a low readiness score? You can revisit issues later.")) {
                      // Soft override placeholder — wired up when Join Studio ships.
                    }
                  }}
                  data-testid="override-low-score"
                >
                  Continue anyway →
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {dataset.issues.length === 0 ? (
        <Card>
          <CardContent className="py-8 flex flex-col items-center text-center gap-2 text-muted-foreground">
            <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            <p className="text-sm font-medium text-foreground">No quality issues</p>
            <p className="text-xs max-w-md">
              Gen-BI didn't find any missing values, duplicates, or format problems in this dataset.
            </p>
          </CardContent>
        </Card>
      ) : (
        grouped.map(([category, issues]) => (
          <Card key={category} data-testid={`issue-group-${category}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                {CATEGORY_LABEL[category] ?? category}
                <Badge variant="outline" className="text-[10px] font-normal">
                  {issues.length}
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                {issues.reduce((s, x) => s + x.count, 0).toLocaleString()} affected rows / cells
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {issues.map((issue) => (
                <div
                  key={issue.id}
                  className="border border-border rounded-lg p-3 flex items-start gap-3"
                  data-testid={`issue-${issue.id}`}
                >
                  <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wide", SEVERITY_TONE[issue.severity])}>
                    {issue.severity}
                  </Badge>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-medium">{issue.message}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Suggested fix:</span> {issue.suggestedFix}
                    </p>
                    {issue.column && (
                      <p className="text-[10px] text-muted-foreground">column: {issue.column}</p>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}

      {/* tiny hint that the workspace cares about the score */}
      <div className="text-[11px] text-muted-foreground">
        Score updates automatically when you override column types in Understanding. Workspace #{workspaceId}'s overall
        readiness is the average across all uploaded files.
        <Progress value={dataset.readinessScore} className="mt-2 h-1.5" />
      </div>
    </div>
  );
}

function ScoreGauge({ score, ringClassName }: { score: number; ringClassName: string }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * c;
  return (
    <svg width="100" height="100" viewBox="0 0 100 100" className="flex-shrink-0" data-testid="score-gauge">
      <circle cx="50" cy="50" r={r} className="stroke-muted" strokeWidth="8" fill="none" />
      <circle
        cx="50"
        cy="50"
        r={r}
        className={cn("transition-all", ringClassName)}
        strokeWidth="8"
        fill="none"
        strokeDasharray={`${dash} ${c - dash}`}
        strokeDashoffset={c / 4}
        strokeLinecap="round"
      />
      <text
        x="50"
        y="55"
        textAnchor="middle"
        className="fill-foreground font-bold"
        style={{ fontSize: "20px" }}
      >
        {score}
      </text>
    </svg>
  );
}
