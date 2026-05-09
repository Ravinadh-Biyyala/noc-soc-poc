import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AnimatedNumber } from "@/lib/animated-number";
import { Sparkles } from "lucide-react";
import { ExplainPanel, ExplainButton } from "@/components/ExplainPanel";
import type { ExplainContext } from "@/lib/explain";
import {
  ResponsiveContainer,
  AreaChart, Area,
  BarChart, Bar,
  LineChart, Line,
  PieChart, Pie, Cell,
  ScatterChart, Scatter, ZAxis,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Treemap,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, Users, BarChart3,
  Activity, Package, Target, ShieldAlert, FileText,
  Hash, Percent, ArrowUpRight, ArrowDownRight, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * True if a numeric coercion yields a finite number. Avoids the recharts
 * footgun where `type="number"` axes silently drop rows whose key is a
 * non-numeric string.
 */
function isFiniteNumeric(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return false;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n);
}

/**
 * Returns true when the column reads as numeric across the bulk of the rows
 * (>=70% finite). Below that threshold a chart should treat the axis as
 * categorical, otherwise non-numeric labels (e.g. customer names) get
 * coerced to NaN and the entire scatter renders empty.
 */
function isNumericColumn(rows: any[], key: string): boolean {
  if (!rows.length) return false;
  let n = 0;
  for (const row of rows) if (isFiniteNumeric(row?.[key])) n++;
  return n / rows.length >= 0.7;
}

/** Friendly placeholder so a missing/malformed chart never silently renders empty. */
function EmptyChartState({ message }: { message: string }) {
  return (
    <div className="h-[280px] flex flex-col items-center justify-center gap-2 text-muted-foreground">
      <AlertCircle className="w-5 h-5 opacity-50" />
      <p className="text-xs">{message}</p>
    </div>
  );
}

const PALETTE = [
  "#1565C0", "#0288D1", "#00838F", "#00695C", "#2E7D32",
  "#F57F17", "#E65100", "#AD1457", "#6A1B9A", "#4527A0",
  "#5C6BC0", "#26A69A", "#66BB6A", "#FFA726", "#EF5350",
];

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  DollarSign, Users, BarChart3, Activity, Package, Target,
  ShieldAlert, FileText, Hash, Percent, TrendingUp, TrendingDown,
  ArrowUpRight,
};

function getIcon(name?: string) {
  if (!name) return BarChart3;
  return ICON_MAP[name] || BarChart3;
}

function formatValue(val: unknown, format?: string): string {
  if (val === null || val === undefined) return "—";
  const num = typeof val === "number" ? val : Number(val);
  if (isNaN(num)) return String(val);
  if (format === "currency") {
    // Sign goes outside the $ so negatives read as "-$1.2M", not "$-1.2M".
    const sign = num < 0 ? "-" : "";
    const abs = Math.abs(num);
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
    return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  if (format === "percent") return `${num.toFixed(1)}%`;
  if (Math.abs(num) >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (Math.abs(num) >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return num.toLocaleString();
}

function KPICard({ kpi, index = 0 }: { kpi: any; index?: number }) {
  const Icon = getIcon(kpi.icon);
  const isPositive = kpi.trend && (kpi.trend.startsWith("+") || kpi.trend.includes("increase"));
  const numericValue = typeof kpi.value === "number" ? kpi.value : Number(kpi.value);
  const isNumeric = !isNaN(numericValue) && Number.isFinite(numericValue);
  const animStyle = { animationDelay: `${index * 70}ms`, animationFillMode: "both" as const };

  const [explainOpen, setExplainOpen] = useState(false);
  const explainCtx: ExplainContext = {
    kind: "kpi",
    title: kpi.label,
    value: kpi.value,
    format: kpi.format,
    source: "Generated dashboard · prepared dataset",
    notes: kpi.trend ? [`Trend reported by Gen-BI: ${kpi.trend}`] : undefined,
  };

  return (
    <>
      <Card
        className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 animate-in fade-in slide-in-from-bottom-3 duration-500 group"
        style={animStyle}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1 min-w-0">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider truncate">{kpi.label}</p>
              <p className="text-2xl font-bold text-foreground tracking-tight tabular-nums truncate">
                {isNumeric ? (
                  <AnimatedNumber value={numericValue} format={(n) => formatValue(n, kpi.format)} />
                ) : (
                  formatValue(kpi.value, kpi.format)
                )}
              </p>
              {kpi.trend && (
                <div className={cn("flex items-center gap-1 text-[11px] font-medium", isPositive ? "text-emerald-600" : "text-red-500")}>
                  {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {kpi.trend}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <ExplainButton
                onClick={() => setExplainOpen(true)}
                className="opacity-0 group-hover:opacity-100"
              />
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Icon className="w-4.5 h-4.5 text-primary" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      <ExplainPanel open={explainOpen} onOpenChange={setExplainOpen} context={explainCtx} />
    </>
  );
}

function ChartCard({ chart }: { chart: any }) {
  const [explainOpen, setExplainOpen] = useState(false);
  const data = chart.data || [];
  const xKey = chart.xKey || Object.keys(data[0] || {})[0] || "name";
  const yKey = chart.yKey || Object.keys(data[0] || {})[1] || "value";
  const yKeys = Array.isArray(yKey) ? yKey : [yKey];

  const tooltipStyle = {
    backgroundColor: "#fff",
    borderColor: "hsl(var(--border))",
    borderRadius: "8px",
    fontSize: "11px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
  };

  const renderChart = () => {
    switch (chart.type) {
      case "area":
        return (
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              {yKeys.map((k: string, i: number) => (
                <linearGradient key={k} id={`grad-${chart.id}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={PALETTE[i % PALETTE.length]} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={PALETTE[i % PALETTE.length]} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey={xKey} fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
            <YAxis fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatValue(v)} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatValue(v)]} />
            {yKeys.map((k: string, i: number) => (
              <Area key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} fillOpacity={1} fill={`url(#grad-${chart.id}-${i})`} />
            ))}
          </AreaChart>
        );

      case "bar":
      case "stacked-bar":
        return (
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey={xKey} fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="hsl(var(--muted-foreground))" />
            <YAxis fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatValue(v)} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatValue(v)]} />
            {yKeys.length > 1 && <Legend iconSize={8} wrapperStyle={{ fontSize: "10px" }} />}
            {yKeys.map((k: string, i: number) => (
              <Bar key={k} dataKey={k} stackId={chart.type === "stacked-bar" ? "stack" : undefined} fill={PALETTE[i % PALETTE.length]} radius={chart.type === "stacked-bar" ? undefined : [4, 4, 0, 0]}>
                {yKeys.length === 1 && data.map((_: any, idx: number) => (
                  <Cell key={idx} fill={PALETTE[idx % PALETTE.length]} />
                ))}
              </Bar>
            ))}
          </BarChart>
        );

      case "horizontal-bar":
        return (
          <BarChart data={data} layout="vertical" margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
            <XAxis type="number" fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatValue(v)} />
            <YAxis dataKey={xKey} type="category" fontSize={9} tickLine={false} axisLine={false} width={90} stroke="hsl(var(--muted-foreground))" />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatValue(v)]} />
            <Bar dataKey={yKeys[0]} radius={[0, 4, 4, 0]}>
              {data.map((_: any, idx: number) => (
                <Cell key={idx} fill={PALETTE[idx % PALETTE.length]} />
              ))}
            </Bar>
          </BarChart>
        );

      case "line":
        return (
          <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey={xKey} fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
            <YAxis fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatValue(v)} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatValue(v)]} />
            {yKeys.length > 1 && <Legend iconSize={8} wrapperStyle={{ fontSize: "10px" }} />}
            {yKeys.map((k: string, i: number) => (
              <Line key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ fill: PALETTE[i % PALETTE.length], r: 3 }} />
            ))}
          </LineChart>
        );

      case "pie":
      case "donut":
        return (
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={chart.type === "donut" ? "55%" : 0}
              outerRadius="80%"
              paddingAngle={2}
              dataKey={yKeys[0]}
              nameKey={xKey}
              label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
              labelLine={false}
              fontSize={9}
            >
              {data.map((_: any, idx: number) => (
                <Cell key={idx} fill={PALETTE[idx % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatValue(v)]} />
          </PieChart>
        );

      case "scatter":
      case "bubble": {
        // Pick a size series for bubble charts: explicit config wins, then a
        // second yKey, then fall back to the primary so points are at least
        // visible (just uniform-sized).
        const sizeKey = chart.config?.sizeKey || yKeys[1] || yKeys[0];
        const isBubble = chart.type === "bubble";
        const xIsNumeric = isNumericColumn(data, xKey);
        // Drop rows missing a y-value so the auto-domain isn't dominated by
        // NaNs, and (for numeric x) drop bad x-values too. Without this the
        // axes draw but no points plot.
        const cleanData = data.filter((d: any) => isFiniteNumeric(d?.[yKeys[0]]) && (!xIsNumeric || isFiniteNumeric(d?.[xKey])));
        if (cleanData.length === 0) {
          return <EmptyChartState message="No numeric data points to plot" />;
        }
        return (
          <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: xIsNumeric ? 0 : 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey={xKey}
              type={xIsNumeric ? "number" : "category"}
              fontSize={10}
              tickLine={false}
              axisLine={false}
              stroke="hsl(var(--muted-foreground))"
              name={xKey}
              angle={xIsNumeric ? 0 : -20}
              textAnchor={xIsNumeric ? "middle" : "end"}
              tickFormatter={xIsNumeric ? (v) => formatValue(v) : undefined}
              allowDuplicatedCategory={false}
            />
            <YAxis dataKey={yKeys[0]} type="number" fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" name={yKeys[0]} tickFormatter={(v) => formatValue(v)} />
            {isBubble && <ZAxis dataKey={sizeKey} range={[60, 600]} name={sizeKey} />}
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatValue(v)]} cursor={{ strokeDasharray: "3 3" }} />
            <Scatter data={cleanData} fill={PALETTE[0]} fillOpacity={isBubble ? 0.7 : 1}>
              {cleanData.map((_: any, idx: number) => (
                <Cell key={idx} fill={PALETTE[idx % PALETTE.length]} />
              ))}
            </Scatter>
          </ScatterChart>
        );
      }

      case "radar":
        return (
          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
            <PolarGrid stroke="hsl(var(--border))" />
            <PolarAngleAxis dataKey={xKey} fontSize={9} stroke="hsl(var(--muted-foreground))" />
            <PolarRadiusAxis fontSize={8} stroke="hsl(var(--muted-foreground))" />
            {yKeys.map((k: string, i: number) => (
              <Radar key={k} dataKey={k} stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.2} strokeWidth={2} />
            ))}
            <Tooltip contentStyle={tooltipStyle} />
          </RadarChart>
        );

      case "treemap":
        return (
          <Treemap
            data={data.map((d: any, i: number) => ({ ...d, fill: PALETTE[i % PALETTE.length] }))}
            dataKey={yKeys[0]}
            nameKey={xKey}
            aspectRatio={4 / 3}
            stroke="#fff"
            content={<TreemapContent />}
          />
        );

      case "stacked-area":
        return (
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey={xKey} fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
            <YAxis fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatValue(v)} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatValue(v)]} />
            <Legend iconSize={8} wrapperStyle={{ fontSize: "10px" }} />
            {yKeys.map((k: string, i: number) => (
              <Area key={k} type="monotone" dataKey={k} stackId="1" stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.6} />
            ))}
          </AreaChart>
        );

      case "gauge":
        return <GaugeChart value={data[0]?.[yKeys[0]] || 0} max={chart.config?.max || 100} label={chart.config?.label || yKeys[0]} />;

      case "waterfall":
        return <WaterfallChart data={data} xKey={xKey} yKey={yKeys[0]} />;

      case "heatmap":
        return <HeatmapChart data={data} xKey={xKey} yKey={yKeys[0]} valueKey={chart.config?.valueKey || "value"} />;

      case "progress-bar":
        return <ProgressBars data={data} nameKey={xKey} valueKey={yKeys[0]} maxKey={chart.config?.maxKey} />;

      case "number-card":
        return null;

      default:
        return (
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey={xKey} fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" />
            <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => formatValue(v)} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey={yKeys[0]} fill={PALETTE[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        );
    }
  };

  if (chart.type === "number-card") return null;

  // Hard guard: a chart with no data must never render as an empty axis grid.
  // The server already filters these out, but a client-side guard keeps the
  // UI honest if a stale dashboard is loaded from localStorage.
  const hasData = Array.isArray(data) && data.length > 0;

  const isWide = ["treemap", "heatmap", "stacked-area", "stacked-bar", "waterfall", "scatter", "bubble"].includes(chart.type);

  const explainCtx: ExplainContext = {
    kind: "chart",
    title: chart.title,
    chartType: chart.type,
    xKey,
    yKeys: Array.isArray(yKey) ? yKey : [yKey],
    data,
    source: "Generated dashboard · prepared dataset",
    notes: chart.subtitle ? [chart.subtitle] : undefined,
  };

  return (
    <>
      <Card className={cn("shadow-sm hover:shadow-md transition-shadow", isWide ? "col-span-2" : "")}>
        <CardHeader className="pb-1">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold text-foreground truncate">{chart.title}</CardTitle>
            <ExplainButton onClick={() => setExplainOpen(true)} />
          </div>
          {chart.subtitle && <CardDescription className="text-xs">{chart.subtitle}</CardDescription>}
        </CardHeader>
        <CardContent>
          <div className={cn("w-full", chart.type === "progress-bar" ? "" : "h-[280px]")}>
            {!hasData ? (
              <EmptyChartState message="No data available for this view" />
            ) : chart.type === "progress-bar" || chart.type === "gauge" || chart.type === "heatmap" || chart.type === "waterfall" ? (
              renderChart()
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                {renderChart() as any}
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>
      <ExplainPanel open={explainOpen} onOpenChange={setExplainOpen} context={explainCtx} />
    </>
  );
}

function TreemapContent(props: any) {
  const { x, y, width, height, name, fill } = props;
  if (width < 30 || height < 25) return null;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="#fff" strokeWidth={2} rx={4} />
      {width > 50 && height > 30 && (
        <text x={x + width / 2} y={y + height / 2} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={Math.min(12, width / 8)} fontWeight="600">
          {name?.length > 12 ? name.slice(0, 12) + "…" : name}
        </text>
      )}
    </g>
  );
}

function GaugeChart({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = Math.min((value / max) * 100, 100);
  const color = pct > 75 ? "#2E7D32" : pct > 50 ? "#F57F17" : "#E65100";

  return (
    <div className="flex flex-col items-center justify-center h-[280px] gap-4">
      <div className="relative w-44 h-44">
        <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
          <circle cx="60" cy="60" r="50" fill="none" stroke="hsl(var(--border))" strokeWidth="10" />
          <circle
            cx="60" cy="60" r="50" fill="none"
            stroke={color}
            strokeWidth="10"
            strokeDasharray={`${(pct / 100) * 314.16} 314.16`}
            strokeLinecap="round"
            className="transition-all duration-1000"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-foreground">{formatValue(value)}</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
        </div>
      </div>
    </div>
  );
}

function WaterfallChart({ data, xKey, yKey }: { data: any[]; xKey: string; yKey: string }) {
  const processed = useMemo(() => {
    let cumulative = 0;
    return data.map((d, i) => {
      const val = Number(d[yKey]) || 0;
      const start = cumulative;
      cumulative += val;
      return { name: d[xKey], value: val, start, end: cumulative, fill: i === data.length - 1 ? PALETTE[0] : val >= 0 ? PALETTE[4] : PALETTE[14] };
    });
  }, [data, xKey, yKey]);

  return (
    <div className="h-[280px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={processed} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="name" fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="hsl(var(--muted-foreground))" />
          <YAxis fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatValue(v)} />
          <Tooltip contentStyle={{ backgroundColor: "#fff", borderColor: "hsl(var(--border))", borderRadius: "8px", fontSize: "11px" }} formatter={(v: number) => [formatValue(v)]} />
          <Bar dataKey="start" stackId="waterfall" fill="transparent" />
          <Bar dataKey="value" stackId="waterfall" radius={[3, 3, 0, 0]}>
            {processed.map((d, i) => <Cell key={i} fill={d.fill} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function HeatmapChart({ data, xKey, yKey, valueKey }: { data: any[]; xKey: string; yKey: string; valueKey: string }) {
  const allValues = data.map((d) => Number(d[valueKey]) || 0);
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);

  const getColor = (val: number) => {
    const t = maxVal === minVal ? 0.5 : (val - minVal) / (maxVal - minVal);
    const r = Math.round(255 - t * 234);
    const g = Math.round(255 - t * 188);
    const b = Math.round(255 - t * 63);
    return `rgb(${r}, ${g}, ${b})`;
  };

  const xValues = [...new Set(data.map((d) => String(d[xKey])))];
  const yValues = [...new Set(data.map((d) => String(d[yKey])))];

  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="p-1.5 text-left text-muted-foreground font-medium"></th>
            {xValues.map((x) => (
              <th key={x} className="p-1.5 text-center text-muted-foreground font-medium text-[10px]">{x}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {yValues.map((y) => (
            <tr key={y}>
              <td className="p-1.5 font-medium text-muted-foreground text-[10px]">{y}</td>
              {xValues.map((x) => {
                const item = data.find((d) => String(d[xKey]) === x && String(d[yKey]) === y);
                const val = item ? Number(item[valueKey]) || 0 : 0;
                return (
                  <td key={x} className="p-1">
                    <div
                      className="rounded-md h-8 flex items-center justify-center text-[10px] font-semibold"
                      style={{ backgroundColor: getColor(val), color: val > (maxVal - minVal) / 2 + minVal ? "#fff" : "#333" }}
                    >
                      {formatValue(val)}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProgressBars({ data, nameKey, valueKey, maxKey }: { data: any[]; nameKey: string; valueKey: string; maxKey?: string }) {
  const maxVal = maxKey ? Math.max(...data.map((d) => Number(d[maxKey]) || 100)) : Math.max(...data.map((d) => Number(d[valueKey]) || 0));

  return (
    <div className="space-y-3 py-2">
      {data.slice(0, 10).map((d: any, i: number) => {
        const val = Number(d[valueKey]) || 0;
        const max = maxKey ? Number(d[maxKey]) || 100 : maxVal;
        const pct = Math.min((val / max) * 100, 100);
        return (
          <div key={i} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-foreground truncate">{d[nameKey]}</span>
              <span className="text-muted-foreground font-mono">{formatValue(val)}</span>
            </div>
            <div className="h-2.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${pct}%`, backgroundColor: PALETTE[i % PALETTE.length] }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DataTable({ table }: { table: any }) {
  const columns = table.columns || Object.keys(table.data?.[0] || {});
  const data = table.data || [];

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{table.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border overflow-hidden overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50">
                {columns.map((col: string) => (
                  <th key={col} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                    {col.replace(/([A-Z])/g, " $1").replace(/^./, (s: string) => s.toUpperCase())}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 10).map((row: any, i: number) => (
                <tr key={i} className={i % 2 === 1 ? "bg-muted/20" : ""}>
                  {columns.map((col: string) => {
                    const val = row[col];
                    const isNum = typeof val === "number";
                    const isHighlight = table.highlightColumn === col;
                    return (
                      <td key={col} className={cn("px-3 py-2 whitespace-nowrap", isNum ? "text-right font-mono" : "", isHighlight ? "font-semibold text-primary" : "")}>
                        {isNum ? formatValue(val) : String(val ?? "")}
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

export default function GeneratedDashboard({ config }: { config: any }) {
  if (!config) return null;

  const kpis = config.kpis || [];
  const charts = config.charts || [];
  const tables = config.tables || [];

  // Stagger chart cards in after the KPIs land for a polished entrance.
  const kpiStaggerEnd = kpis.length * 70;

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-primary/5 via-background to-background p-5 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="absolute -top-12 -right-12 w-40 h-40 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold uppercase tracking-wider mb-2">
              <Sparkles className="w-3 h-3" />
              AI Generated
            </div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">{config.title || "Generated Dashboard"}</h1>
            {config.subtitle && <p className="text-sm text-muted-foreground mt-0.5">{config.subtitle}</p>}
          </div>
        </div>
      </div>

      {kpis.length > 0 && (
        <div className={cn("grid gap-4", kpis.length <= 3 ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-4")}>
          {kpis.map((kpi: any, i: number) => (
            <KPICard key={i} kpi={kpi} index={i} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {charts.map((chart: any, i: number) => (
          <div
            key={chart.id}
            className="animate-in fade-in slide-in-from-bottom-3 duration-500"
            style={{ animationDelay: `${kpiStaggerEnd + i * 80}ms`, animationFillMode: "both" }}
          >
            <ChartCard chart={chart} />
          </div>
        ))}
      </div>

      {tables.length > 0 && (
        <div className={cn("grid gap-5", tables.length >= 2 ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1")}>
          {tables.map((table: any, i: number) => (
            <div
              key={i}
              className="animate-in fade-in slide-in-from-bottom-3 duration-500"
              style={{ animationDelay: `${kpiStaggerEnd + (charts.length + i) * 80}ms`, animationFillMode: "both" }}
            >
              <DataTable table={table} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
