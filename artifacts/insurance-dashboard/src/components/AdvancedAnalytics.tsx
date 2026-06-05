import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart, Area,
  BarChart, Bar,
  ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ZAxis,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, TrendingUp, AlertTriangle, Layers, Grid3x3, BarChart2, BoxSelect, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  classifyDataScienceFitness,
  correlationMatrix,
  detectAnomalies,
  linearForecast,
  kmeansClusters,
  boxPlotStats,
  histogramBins,
  type BoxStats,
  type ColumnInfo,
  type Row,
} from "@/lib/data-science";

interface Props {
  rows: Row[];
  columns: ColumnInfo[];
  defaultOpen?: boolean;
}

const CLUSTER_COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#a855f7", "#06b6d4"];

export default function AdvancedAnalytics({ rows, columns, defaultOpen }: Props) {
  const fitness = useMemo(() => classifyDataScienceFitness(rows, columns), [rows, columns]);
  const [open, setOpen] = useState(!!defaultOpen);
  const numericCols = useMemo(() => columns.filter((c) => c.type === "number"), [columns]);

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Advanced Data Analysis
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              Anomaly detection · Box plots · Distributions · Correlations · Forecasting
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setOpen((v) => !v)}
            data-testid="advanced-analytics-toggle"
          >
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {open ? "Hide" : "Run Advanced Data Analysis"}
          </Button>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4">
          {numericCols.length === 0 ? (
            <div className="text-[12px] text-muted-foreground py-6 text-center">
              No numeric columns detected — analysis requires at least one numeric field.
            </div>
          ) : (
            <>
              {/* Distribution + Box plots — work on any dataset with numeric data */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <DistributionTile rows={rows} columns={columns} numericCols={numericCols} />
                <BoxPlotTile rows={rows} numericCols={numericCols} />
              </div>

              {/* Anomaly + Correlation */}
              {fitness.capabilities.anomalies[0] && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <AnomalyTile rows={rows} numericCols={fitness.capabilities.anomalies} columns={columns} />
                  {fitness.capabilities.correlation && (
                    <CorrelationTile
                      rows={rows}
                      cols={numericCols.slice(0, 6).map((c) => c.name)}
                    />
                  )}
                </div>
              )}

              {/* Forecast + Clusters */}
              {(fitness.capabilities.forecast || fitness.capabilities.clusters) && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {fitness.capabilities.forecast && (
                    <ForecastTile
                      rows={rows}
                      dateCol={fitness.capabilities.forecast.dateCol}
                      numericCol={fitness.capabilities.forecast.numericCol}
                    />
                  )}
                  {fitness.capabilities.clusters && (
                    <ClusterTile rows={rows} cols={fitness.capabilities.clusters.cols} />
                  )}
                </div>
              )}

              {!fitness.recommended && (
                <p className="text-[11px] text-muted-foreground px-1">
                  Note: Statistical layers (forecast, clustering) need more rows for reliable signal.
                </p>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Distribution (histogram)
// ---------------------------------------------------------------------------

function DistributionTile({ rows, columns, numericCols }: { rows: Row[]; columns: ColumnInfo[]; numericCols: ColumnInfo[] }) {
  const [activeCol, setActiveCol] = useState(numericCols[0]?.name ?? "");
  const bins = useMemo(() => histogramBins(rows, activeCol, 10), [rows, activeCol]);

  return (
    <Card className="bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-cyan-500" /> Distribution
          </CardTitle>
          {numericCols.length > 1 && (
            <select
              value={activeCol}
              onChange={(e) => setActiveCol(e.target.value)}
              className="text-[10px] bg-muted border border-border rounded px-1.5 py-0.5"
            >
              {numericCols.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          )}
        </div>
        <CardDescription className="text-[11px]">
          Frequency distribution of {activeCol}
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-3">
        {bins.length === 0 ? (
          <div className="text-[12px] text-muted-foreground py-4 text-center">
            Not enough data to build a distribution for {activeCol}.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={bins} margin={{ top: 4, right: 8, bottom: 24, left: -10 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} angle={-40} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 6 }}
                formatter={(v: number) => [v, "Count"]}
                labelFormatter={(l) => `From ${l}`}
              />
              <Bar dataKey="count" fill="#06b6d4" fillOpacity={0.85} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Box plots
// ---------------------------------------------------------------------------

function BoxPlotTile({ rows, numericCols }: { rows: Row[]; numericCols: ColumnInfo[] }) {
  const statsList = useMemo(
    () =>
      numericCols
        .slice(0, 5)
        .map((c) => boxPlotStats(rows, c.name))
        .filter(Boolean) as BoxStats[],
    [rows, numericCols],
  );

  return (
    <Card className="bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <BoxSelect className="w-4 h-4 text-violet-500" /> Box Plots
        </CardTitle>
        <CardDescription className="text-[11px]">
          IQR box · whiskers at 1.5×IQR · <span className="text-amber-500">◆</span> mean · <span className="text-red-500">○</span> outliers
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-3">
        {statsList.length === 0 ? (
          <div className="text-[12px] text-muted-foreground py-4 text-center">
            Need at least 4 data points per column.
          </div>
        ) : (
          <div className="space-y-4 pt-1">
            {statsList.map((s) => (
              <BoxPlotRow key={s.col} stats={s} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BoxPlotRow({ stats }: { stats: BoxStats }) {
  const range = stats.max - stats.min;
  if (range === 0) return null;

  const px = (v: number) => ((v - stats.min) / range) * 100;
  const fmt = (n: number) =>
    Math.abs(n) >= 10000
      ? (n / 1000).toFixed(1) + "k"
      : n.toLocaleString(undefined, { maximumFractionDigits: 1 });

  const boxLeft = px(stats.q1);
  const boxWidth = px(stats.q3) - px(stats.q1);
  const medianPct = px(stats.median);
  const meanPct = px(stats.mean);
  const wLowPct = px(stats.whiskerLow);
  const wHighPct = px(stats.whiskerHigh);

  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-foreground/70 truncate">{stats.col}</div>
      <div className="relative h-9 w-full select-none">
        {/* Whisker line */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-px bg-slate-400"
          style={{ left: `${wLowPct}%`, width: `${wHighPct - wLowPct}%` }}
        />
        {/* Whisker end-caps */}
        <div className="absolute top-[28%] w-px h-[44%] bg-slate-400" style={{ left: `${wLowPct}%` }} />
        <div className="absolute top-[28%] w-px h-[44%] bg-slate-400" style={{ left: `${wHighPct}%` }} />
        {/* IQR box */}
        <div
          className="absolute top-[20%] h-[60%] rounded bg-violet-500/15 border border-violet-500"
          style={{ left: `${boxLeft}%`, width: `${boxWidth}%` }}
        />
        {/* Median line */}
        <div
          className="absolute top-[18%] w-0.5 h-[64%] bg-violet-600"
          style={{ left: `${medianPct}%` }}
        />
        {/* Mean diamond */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-amber-400"
          style={{ left: `${meanPct}%` }}
        />
        {/* Outliers */}
        {stats.outliers.slice(0, 20).map((v, i) => (
          <div
            key={i}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full border border-red-500"
            style={{ left: `${px(v)}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground px-0.5">
        <span>{fmt(stats.min)}</span>
        <span>Q1 {fmt(stats.q1)}</span>
        <span className="font-semibold text-violet-600">Md {fmt(stats.median)}</span>
        <span>Q3 {fmt(stats.q3)}</span>
        <span>{fmt(stats.max)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forecast
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
  const firstProjection = useMemo(() => data.find((d) => d.actual === null) ?? null, [data]);

  if (data.length === 0) {
    return (
      <Card className="bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-500" /> Forecast — {numericCol}
          </CardTitle>
          <CardDescription className="text-[11px]">
            Not enough history on {dateCol} to project (need ≥ 4 dated points).
          </CardDescription>
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
          Linear projection · {direction} · 95% confidence band
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-3">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -10 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} />
            <Area type="monotone" dataKey="upper" stroke="none" fill="#3b82f6" fillOpacity={0.08} />
            <Area type="monotone" dataKey="lower" stroke="none" fill="#3b82f6" fillOpacity={0.08} />
            <Area type="monotone" dataKey="actual" stroke="#1e293b" strokeWidth={2} fill="none" dot={false} connectNulls={false} />
            <Area type="monotone" dataKey="forecast" stroke="#3b82f6" strokeWidth={2} fill="none" strokeDasharray="4 4" dot={false} />
            {firstProjection && (
              <ReferenceLine
                x={firstProjection.date}
                stroke="#94a3b8"
                strokeDasharray="2 2"
                label={{ value: "today", fontSize: 9, fill: "#64748b" }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Correlation matrix
// ---------------------------------------------------------------------------

function CorrelationTile({ rows, cols }: { rows: Row[]; cols: string[] }) {
  const cells = useMemo(() => correlationMatrix(rows, cols), [rows, cols]);
  const top = useMemo(
    () =>
      [...cells]
        .filter((c) => c.a !== c.b)
        .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0],
    [cells],
  );

  const colorFor = (r: number) => {
    const a = Math.min(1, Math.abs(r));
    return r >= 0
      ? `rgba(59, 130, 246, ${0.08 + a * 0.7})`
      : `rgba(239, 68, 68, ${0.08 + a * 0.7})`;
  };

  return (
    <Card className="bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Grid3x3 className="w-4 h-4 text-purple-500" /> Correlation matrix
        </CardTitle>
        <CardDescription className="text-[11px]">
          {top
            ? `Strongest: ${top.a} ↔ ${top.b} (r=${top.r.toFixed(2)})`
            : "No strong correlations detected"}
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="overflow-x-auto">
          <table className="text-[10px] border-separate" style={{ borderSpacing: 2 }}>
            <thead>
              <tr>
                <th />
                {cols.map((c) => (
                  <th key={c} className="px-1 py-0.5 font-medium text-muted-foreground text-left max-w-[80px] truncate">
                    {c}
                  </th>
                ))}
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
                      <td
                        key={colCol}
                        className="text-center font-mono text-foreground"
                        style={{ background: colorFor(r), minWidth: 44, padding: 6, borderRadius: 4 }}
                        title={`${rowCol} ↔ ${colCol}: r = ${r.toFixed(3)}`}
                      >
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
// Clusters
// ---------------------------------------------------------------------------

function ClusterTile({ rows, cols }: { rows: Row[]; cols: [string, string] }) {
  const result = useMemo(() => kmeansClusters(rows, cols, 4), [rows, cols]);
  const seriesByCluster = useMemo(() => {
    const out: { cluster: number; points: { x: number; y: number }[] }[] = [];
    for (let c = 0; c < result.centroids.length; c++) {
      out.push({
        cluster: c,
        points: result.points.filter((p) => p.cluster === c).map((p) => ({ x: p.x, y: p.y })),
      });
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
          {result.centroids.length} clusters across {result.points.length.toLocaleString()} points
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
              <Scatter
                key={s.cluster}
                name={`Cluster ${s.cluster + 1} (${s.points.length})`}
                data={s.points}
                fill={CLUSTER_COLORS[s.cluster % CLUSTER_COLORS.length]}
                fillOpacity={0.65}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Anomalies
// ---------------------------------------------------------------------------

function AnomalyTile({ rows, numericCols, columns }: { rows: Row[]; numericCols: string[]; columns: ColumnInfo[] }) {
  const [activeCol, setActiveCol] = useState(numericCols[0]);
  const anomalies = useMemo(() => detectAnomalies(rows, activeCol, 6), [rows, activeCol]);
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
              {numericCols.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
        </div>
        <CardDescription className="text-[11px]">
          Rows with |z-score| ≥ 1.5 on {activeCol}
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-3">
        {anomalies.length === 0 ? (
          <div className="text-[12px] text-muted-foreground py-4 text-center">
            No outliers detected on {activeCol}.
          </div>
        ) : (
          <div className="space-y-1">
            {anomalies.map((a) => (
              <div
                key={a.rowIndex}
                className="flex items-center justify-between text-[12px] bg-muted/40 rounded px-2 py-1.5"
              >
                <span className="truncate text-foreground max-w-[55%]">
                  {String(a.row[labelCol] ?? `row ${a.rowIndex}`)}
                </span>
                <span className="font-mono text-foreground tabular-nums">
                  {a.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
                <span
                  className={cn(
                    "font-mono text-[10px] px-1.5 py-0.5 rounded",
                    a.z > 0 ? "bg-blue-500/15 text-blue-600" : "bg-red-500/15 text-red-600",
                  )}
                >
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
