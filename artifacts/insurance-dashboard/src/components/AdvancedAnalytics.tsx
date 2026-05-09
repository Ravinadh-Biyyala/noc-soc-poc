import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart, Line,
  AreaChart, Area,
  ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ZAxis,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, TrendingUp, AlertTriangle, Layers, Grid3x3, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  classifyDataScienceFitness,
  correlationMatrix,
  detectAnomalies,
  linearForecast,
  kmeansClusters,
  type ColumnInfo,
  type Row,
} from "@/lib/data-science";

interface Props {
  rows: Row[];
  columns: ColumnInfo[];
  /** When true, the panel renders open from the start (used by the Customer 360 demo). */
  defaultOpen?: boolean;
}

const CLUSTER_COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#a855f7", "#06b6d4"];

/**
 * The "Data Scientist" surface. Renders four advanced tiles when the data
 * has enough signal to be worth the complexity, with a deterministic
 * fitness gate so we don't pretend a 12-row CSV needs k-means.
 */
export default function AdvancedAnalytics({ rows, columns, defaultOpen }: Props) {
  const fitness = useMemo(() => classifyDataScienceFitness(rows, columns), [rows, columns]);
  const [open, setOpen] = useState(!!defaultOpen);

  if (!fitness.recommended) {
    // Don't take up space if the dataset can't support it — but still leave
    // a single one-line note so the user understands why no panel showed up.
    return (
      <div className="text-[11px] text-muted-foreground px-1">
        Advanced analytics skipped — dataset is too small or too uniform for predictive layers.
      </div>
    );
  }

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Data Scientist agent
              <Badge variant="secondary" className="text-[10px] h-5">Score {fitness.score}/100</Badge>
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              {fitness.reasons.slice(0, 2).join(" · ")}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setOpen((v) => !v)} data-testid="advanced-analytics-toggle">
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {open ? "Hide" : "Run advanced analysis"}
          </Button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {fitness.capabilities.forecast && (
              <ForecastTile rows={rows} dateCol={fitness.capabilities.forecast.dateCol} numericCol={fitness.capabilities.forecast.numericCol} />
            )}
            {fitness.capabilities.correlation && (
              <CorrelationTile rows={rows} cols={columns.filter((c) => c.type === "number").slice(0, 6).map((c) => c.name)} />
            )}
            {fitness.capabilities.clusters && (
              <ClusterTile rows={rows} cols={fitness.capabilities.clusters.cols} />
            )}
            {fitness.capabilities.anomalies[0] && (
              <AnomalyTile rows={rows} numericCols={fitness.capabilities.anomalies} columns={columns} />
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function ForecastTile({ rows, dateCol, numericCol }: { rows: Row[]; dateCol: string; numericCol: string }) {
  const data = useMemo(() => linearForecast(rows, dateCol, numericCol, 7), [rows, dateCol, numericCol]);
  const slope = useMemo(() => {
    const fit = data.filter((d) => d.actual !== null);
    if (fit.length < 2) return 0;
    const first = fit[0].forecast;
    const last = fit[fit.length - 1].forecast;
    if (first == null || last == null) return 0;
    return (last - first) / fit.length;
  }, [data]);
  const direction = slope > 0 ? "↑ trending up" : slope < 0 ? "↓ trending down" : "flat";
  // First projected (no-actual) point — used as the "today" divider. Guard
  // for the case where linearForecast returned [] (e.g. < 4 historical
  // points) so we never crash the panel.
  const firstProjection = useMemo(() => data.find((d) => d.actual === null) ?? null, [data]);

  if (data.length === 0) {
    return (
      <Card className="bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-500" /> Forecast — {numericCol}
          </CardTitle>
          <CardDescription className="text-[11px]">Not enough history on {dateCol} to project (need ≥ 4 dated points).</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-blue-500" /> Forecast — {numericCol}
        </CardTitle>
        <CardDescription className="text-[11px]">
          Linear projection of next 7 periods · {direction} · 95% confidence band
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-3">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -10 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} />
            {/* Confidence band */}
            <Area type="monotone" dataKey="upper" stroke="none" fill="#3b82f6" fillOpacity={0.08} />
            <Area type="monotone" dataKey="lower" stroke="none" fill="#3b82f6" fillOpacity={0.08} />
            <Line type="monotone" dataKey="actual" stroke="#1e293b" strokeWidth={2} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="forecast" stroke="#3b82f6" strokeWidth={2} strokeDasharray="4 4" dot={false} />
            {firstProjection && (
              <ReferenceLine x={firstProjection.date} stroke="#94a3b8" strokeDasharray="2 2" label={{ value: "today", fontSize: 9, fill: "#64748b" }} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function CorrelationTile({ rows, cols }: { rows: Row[]; cols: string[] }) {
  const cells = useMemo(() => correlationMatrix(rows, cols), [rows, cols]);
  // Find the strongest non-self pair for the headline insight.
  const top = useMemo(() => {
    return [...cells]
      .filter((c) => c.a !== c.b)
      .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0];
  }, [cells]);

  const colorFor = (r: number) => {
    const a = Math.min(1, Math.abs(r));
    return r >= 0
      ? `rgba(59, 130, 246, ${0.08 + a * 0.7})`   // blue for positive
      : `rgba(239, 68, 68, ${0.08 + a * 0.7})`;   // red for negative
  };

  return (
    <Card className="bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Grid3x3 className="w-4 h-4 text-purple-500" /> Correlation matrix
        </CardTitle>
        <CardDescription className="text-[11px]">
          {top ? `Strongest signal: ${top.a} ↔ ${top.b} (r=${top.r.toFixed(2)})` : "No strong correlations detected"}
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="overflow-x-auto">
          <table className="text-[10px] border-separate" style={{ borderSpacing: 2 }}>
            <thead>
              <tr>
                <th />
                {cols.map((c) => (<th key={c} className="px-1 py-0.5 font-medium text-muted-foreground text-left max-w-[80px] truncate">{c}</th>))}
              </tr>
            </thead>
            <tbody>
              {cols.map((rowCol) => (
                <tr key={rowCol}>
                  <td className="pr-2 font-medium text-muted-foreground text-right max-w-[80px] truncate">{rowCol}</td>
                  {cols.map((colCol) => {
                    const cell = cells.find((c) => c.a === rowCol && c.b === colCol);
                    const r = cell?.r ?? 0;
                    return (
                      <td key={colCol} className="text-center font-mono text-foreground" style={{ background: colorFor(r), minWidth: 44, padding: 6, borderRadius: 4 }} title={`${rowCol} ↔ ${colCol}: r = ${r.toFixed(3)}`}>
                        {r.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function ClusterTile({ rows, cols }: { rows: Row[]; cols: [string, string] }) {
  const result = useMemo(() => kmeansClusters(rows, cols, 4), [rows, cols]);
  // Recharts wants one series per cluster for distinct colors.
  const seriesByCluster = useMemo(() => {
    const out: { cluster: number; points: { x: number; y: number }[] }[] = [];
    for (let c = 0; c < result.centroids.length; c++) {
      out.push({ cluster: c, points: result.points.filter((p) => p.cluster === c).map((p) => ({ x: p.x, y: p.y })) });
    }
    return out;
  }, [result]);

  return (
    <Card className="bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Layers className="w-4 h-4 text-green-500" /> Segments — k-means on {cols[0]} × {cols[1]}
        </CardTitle>
        <CardDescription className="text-[11px]">
          {result.centroids.length} clusters discovered across {result.points.length.toLocaleString()} points
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-3">
        <ResponsiveContainer width="100%" height={220}>
          <ScatterChart margin={{ top: 6, right: 8, bottom: 0, left: -10 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <XAxis dataKey="x" type="number" tick={{ fontSize: 10 }} name={cols[0]} />
            <YAxis dataKey="y" type="number" tick={{ fontSize: 10 }} name={cols[1]} />
            <ZAxis range={[20, 20]} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ fontSize: 11, borderRadius: 6 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {seriesByCluster.map((s) => (
              <Scatter key={s.cluster} name={`Cluster ${s.cluster + 1} (${s.points.length})`} data={s.points} fill={CLUSTER_COLORS[s.cluster % CLUSTER_COLORS.length]} fillOpacity={0.65} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function AnomalyTile({ rows, numericCols, columns }: { rows: Row[]; numericCols: string[]; columns: ColumnInfo[] }) {
  const [activeCol, setActiveCol] = useState(numericCols[0]);
  const anomalies = useMemo(() => detectAnomalies(rows, activeCol, 6), [rows, activeCol]);
  // Pick a sensible label column to print alongside the anomaly value.
  const labelCol = useMemo(() => {
    const stringCol = columns.find((c) => c.type === "string")?.name;
    return stringCol ?? Object.keys(rows[0] ?? {})[0];
  }, [columns, rows]);

  return (
    <Card className="bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-500" /> Anomalies
          </CardTitle>
          {numericCols.length > 1 && (
            <select
              value={activeCol}
              onChange={(e) => setActiveCol(e.target.value)}
              className="text-[10px] bg-muted border border-border rounded px-1.5 py-0.5"
              data-testid="anomaly-col-select"
            >
              {numericCols.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          )}
        </div>
        <CardDescription className="text-[11px]">
          Top {anomalies.length} rows with |z-score| ≥ 1.5 on {activeCol}
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-3">
        {anomalies.length === 0 ? (
          <div className="text-[12px] text-muted-foreground py-4 text-center">No outliers detected on {activeCol}.</div>
        ) : (
          <div className="space-y-1">
            {anomalies.map((a) => (
              <div key={a.rowIndex} className="flex items-center justify-between text-[12px] bg-muted/40 rounded px-2 py-1.5">
                <span className="truncate text-foreground max-w-[55%]">{String(a.row[labelCol] ?? `row ${a.rowIndex}`)}</span>
                <span className="font-mono text-foreground tabular-nums">{a.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                <span className={cn("font-mono text-[10px] px-1.5 py-0.5 rounded", a.z > 0 ? "bg-blue-500/15 text-blue-600" : "bg-red-500/15 text-red-600")}>
                  z={a.z.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
