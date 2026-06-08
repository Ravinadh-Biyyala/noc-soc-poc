import { lazy, Suspense, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useCustomDashboards } from "@/lib/custom-dashboards";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AnimatedNumber } from "@/lib/animated-number";
import { Maximize2, Wand2, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExplainPanel, ExplainButton } from "@/components/ExplainPanel";
import { autoTidy } from "@/lib/layout-actions";
import AdvancedAnalytics from "@/components/AdvancedAnalytics";
import { useRegisterObservation } from "@/lib/chat-observer";
import { useCopilot } from "@/lib/copilot-context";

// Lazy so the presenter overlay (with its portal + extra deps) doesn't
// inflate the initial dashboard render.
const PresenterMode = lazy(() => import("@/components/PresenterMode"));
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
  ComposedChart,
  FunnelChart, Funnel, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, Minus, DollarSign, Users, BarChart3,
  Activity, Package, Target, ShieldAlert, FileText,
  Hash, Percent, ArrowUpRight, ArrowDownRight, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Formats ISO date strings as plain year labels ("2022-12-31T18:30:00Z" → "2022"). */
function dateTick(v: unknown): string {
  const s = String(v ?? "");
  const m = s.match(/^(\d{4})-\d{2}/);
  return m ? m[1] : s;
}

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
    <div className="h-[280px] flex flex-col items-center justify-center gap-2 text-muted-foreground border border-dashed border-border rounded-lg">
      <AlertCircle className="w-5 h-5 opacity-40" />
      <p className="text-xs text-center px-4">{message}</p>
      <p className="text-[10px] text-muted-foreground/60">Try asking Copilot to re-generate this chart</p>
    </div>
  );
}

// Fallback palette used only when the AI/generator did not specify colors for
// a chart. Colors are normally decided by the AI (auto-pipeline visualization
// agent or the Copilot's pinChartToDashboard) and carried on the chart config.
const DEFAULT_PALETTE = [
  "#1565C0", "#0288D1", "#00838F", "#00695C", "#2E7D32",
  "#F57F17", "#E65100", "#AD1457", "#6A1B9A", "#4527A0",
  "#5C6BC0", "#26A69A", "#66BB6A", "#FFA726", "#EF5350",
];

/** Resolve the colour array for a chart: AI-provided `colors` (array) or
 *  single `color`, falling back to the default palette. Accepts hex / rgb / hsl. */
function resolveColors(chart: any, fallback: string[]): string[] {
  const arr = chart?.colors ?? chart?.config?.colors;
  if (Array.isArray(arr)) {
    const valid = arr.filter((c: unknown) => typeof c === "string" && /^(#|rgb|hsl)/i.test(c.trim()));
    if (valid.length) return valid as string[];
  }
  const single = chart?.color ?? chart?.config?.color;
  if (typeof single === "string" && /^(#|rgb|hsl)/i.test(single.trim())) return [single];
  return fallback;
}

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

/**
 * Ask the Copilot to explain a visual. Sends a CONCISE, human-readable message
 * to the chat (clean bubble) and ships the underlying data separately as hidden
 * context via a window event — CopilotActions exposes it to the agent as a
 * readable, so the explanation is grounded without dumping JSON into the bubble.
 */
function requestExplain(opts: { title: string; kind: string; xKey?: string; yKey?: string | string[]; data?: any[] }) {
  const axes = opts.xKey
    ? ` (x: ${opts.xKey}, y: ${Array.isArray(opts.yKey) ? opts.yKey.join(", ") : opts.yKey})`
    : "";
  const message = `Explain the "${opts.title}" ${opts.kind} in detail${axes} — the headline, the key patterns and outliers, and the main takeaways.`;
  window.dispatchEvent(
    new CustomEvent("copilot:explain", {
      detail: {
        message,
        context: {
          title: opts.title,
          kind: opts.kind,
          xKey: opts.xKey,
          yKey: opts.yKey,
          data: Array.isArray(opts.data) ? opts.data.slice(0, 50) : undefined,
        },
      },
    }),
  );
}

function KPICard({ kpi, index = 0 }: { kpi: any; index?: number }) {
  const Icon = getIcon(kpi.icon);
  const isPositive = kpi.trend && (kpi.trend.startsWith("+") || /increase|growth|improved|higher|above/i.test(kpi.trend));
  const isNegative = kpi.trend && /decline|decrease|down\b|below|loss|fell|dropped|worsened/i.test(kpi.trend);
  const numericValue = typeof kpi.value === "number" ? kpi.value : Number(kpi.value);
  const isNumeric = !isNaN(numericValue) && Number.isFinite(numericValue);
  const animStyle = { animationDelay: `${index * 70}ms`, animationFillMode: "both" as const };

  const { askCopilot } = useCopilot();
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
        className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 animate-in fade-in slide-in-from-bottom-3 duration-500 group cursor-pointer"
        style={animStyle}
        onClick={() => askCopilot(`Explain the "${kpi.label}" KPI (currently ${kpi.value}) in detail — what it measures, what's driving the value (query the project warehouse to break it down if useful), and whether it looks healthy.`)}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1 min-w-0">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider truncate" title={kpi.label}>{kpi.label}</p>
              <p className="text-xl font-bold text-foreground tracking-tight tabular-nums leading-tight whitespace-nowrap">
                {isNumeric ? (
                  <AnimatedNumber value={numericValue} format={(n) => formatValue(n, kpi.format)} />
                ) : (
                  formatValue(kpi.value, kpi.format)
                )}
              </p>
              {kpi.trend && (
                <div className={cn("flex items-center gap-1 text-[11px] font-medium", isPositive ? "text-emerald-600" : isNegative ? "text-red-500" : "text-muted-foreground")}>
                  {isPositive ? <TrendingUp className="w-3 h-3" /> : isNegative ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
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

const DEFAULT_PINNED_COLORS = ["#1565C0", "#0288D1", "#0097A7", "#00838F", "#00695C", "#6366f1", "#8b5cf6"];

function PinnedChart({ chart }: { chart: { type: string; title: string; xKey: string; yKey: string; data: any[]; colors?: string[] } }) {
  const [explainOpen, setExplainOpen] = useState(false);
  const { askCopilot } = useCopilot();
  const { type, title, xKey, yKey, data } = chart;
  // AI-decided colours for this pinned chart (falls back to the default set).
  const PINNED_COLORS = resolveColors(chart, DEFAULT_PINNED_COLORS);
  const fmt = (v: number) => {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    if (v < 1 && v > 0) return `${(v * 100).toFixed(1)}%`;
    return v.toLocaleString();
  };
  const ttStyle = { backgroundColor: "#fff", borderColor: "#e5e7eb", borderRadius: "8px", fontSize: "11px" };

  const explainCtx: ExplainContext = {
    kind: "chart",
    title,
    chartType: type,
    xKey,
    yKeys: [yKey],
    data,
    source: "Pinned from chat",
  };

  if (type === "table") {
    const columns = data.length > 0 ? Object.keys(data[0]) : [];
    return (
      <>
      <Card className="shadow-sm group">
        <CardHeader className="pb-2 pt-4 px-4 cursor-pointer" title="Click to have the Copilot explain this table" onClick={() => requestExplain({ title, kind: "table", data })}>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
            <ExplainButton onClick={() => setExplainOpen(true)} />
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="overflow-auto max-h-[200px] rounded border border-border text-xs">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-muted/50 sticky top-0">
                  {columns.map((col) => (
                    <th key={col} className="text-left px-3 py-1.5 font-semibold text-muted-foreground border-b border-border whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                    {columns.map((col) => (
                      <td key={col} className="px-3 py-1.5 border-b border-border/50 whitespace-nowrap">{row[col] ?? "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <ExplainPanel open={explainOpen} onOpenChange={setExplainOpen} context={explainCtx} />
      </>
    );
  }

  const yKeys = Array.isArray(yKey) ? yKey : [yKey];
  const legendStyle = { fontSize: "10px", paddingTop: "4px" };

  const renderPinnedInner = (): React.ReactElement => {
    switch (type) {
      case "pie":
      case "donut":
        return (
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={type === "donut" ? 40 : 0} outerRadius={75} paddingAngle={2} dataKey={yKeys[0]} nameKey={xKey} label={(entry: any) => entry[xKey]} labelLine={false}>
              {data.map((_: any, i: number) => <Cell key={i} fill={PINNED_COLORS[i % PINNED_COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={ttStyle} formatter={(v: number, _n: string, p: any) => [fmt(v), p?.payload?.[xKey]]} />
          </PieChart>
        );
      case "bar":
      case "stacked-bar":
        return (
          <BarChart data={data} margin={{ top: 4, right: 8, left: 24, bottom: 38 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey={xKey} fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="#6b7280" label={{ value: xKey, position: "insideBottom", offset: -18, fontSize: 10, fill: "#6b7280" }} />
            <YAxis fontSize={9} tickLine={false} axisLine={false} tickFormatter={fmt} stroke="#6b7280" label={{ value: yKeys.join(", "), angle: -90, position: "insideLeft", offset: 0, fontSize: 10, fill: "#6b7280", style: { textAnchor: "middle" } }} />
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [fmt(v)]} />
            {yKeys.length > 1 && <Legend iconSize={8} wrapperStyle={legendStyle} />}
            {yKeys.map((k: string, i: number) => (
              <Bar key={k} dataKey={k} stackId={type === "stacked-bar" ? "s" : undefined} radius={type === "stacked-bar" ? undefined : [4, 4, 0, 0]} fill={PINNED_COLORS[i % PINNED_COLORS.length]}>
                {yKeys.length === 1 && data.map((_: any, j: number) => <Cell key={j} fill={PINNED_COLORS[j % PINNED_COLORS.length]} />)}
              </Bar>
            ))}
          </BarChart>
        );
      case "horizontal-bar":
        return (
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 20, left: 4, bottom: 22 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
            <XAxis type="number" fontSize={9} tickLine={false} axisLine={false} tickFormatter={fmt} stroke="#6b7280" label={{ value: yKeys[0], position: "insideBottom", offset: -8, fontSize: 10, fill: "#6b7280" }} />
            <YAxis dataKey={xKey} type="category" fontSize={9} tickLine={false} axisLine={false} width={90} stroke="#6b7280" />
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [fmt(v)]} />
            <Bar dataKey={yKeys[0]} radius={[0, 4, 4, 0]}>
              {data.map((_: any, i: number) => <Cell key={i} fill={PINNED_COLORS[i % PINNED_COLORS.length]} />)}
            </Bar>
          </BarChart>
        );
      case "line":
        return (
          <LineChart data={data} margin={{ top: 4, right: 8, left: 24, bottom: 38 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey={xKey} fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="#6b7280" tickFormatter={dateTick} label={{ value: xKey, position: "insideBottom", offset: -18, fontSize: 10, fill: "#6b7280" }} />
            <YAxis fontSize={9} tickLine={false} axisLine={false} tickFormatter={fmt} stroke="#6b7280" label={{ value: yKeys.join(", "), angle: -90, position: "insideLeft", offset: 0, fontSize: 10, fill: "#6b7280", style: { textAnchor: "middle" } }} />
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [fmt(v)]} />
            {yKeys.length > 1 && <Legend iconSize={8} wrapperStyle={legendStyle} />}
            {yKeys.map((k: string, i: number) => (
              <Line key={k} type="monotone" dataKey={k} stroke={PINNED_COLORS[i % PINNED_COLORS.length]} strokeWidth={2} dot={{ fill: PINNED_COLORS[i % PINNED_COLORS.length], r: 3 }} />
            ))}
          </LineChart>
        );
      case "scatter":
      case "bubble":
        return (
          <ScatterChart margin={{ top: 4, right: 8, left: 24, bottom: 38 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey={xKey} type="number" fontSize={9} tickLine={false} axisLine={false} stroke="#6b7280" tickFormatter={fmt} label={{ value: xKey, position: "insideBottom", offset: -18, fontSize: 10, fill: "#6b7280" }} />
            <YAxis dataKey={yKeys[0]} type="number" fontSize={9} tickLine={false} axisLine={false} stroke="#6b7280" tickFormatter={fmt} label={{ value: yKeys[0], angle: -90, position: "insideLeft", offset: 0, fontSize: 10, fill: "#6b7280", style: { textAnchor: "middle" } }} />
            {type === "bubble" && <ZAxis dataKey={yKeys[1] || yKeys[0]} range={[40, 400]} />}
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [fmt(v)]} />
            <Scatter data={data} fill={PINNED_COLORS[0]}>
              {data.map((_: any, i: number) => <Cell key={i} fill={PINNED_COLORS[i % PINNED_COLORS.length]} />)}
            </Scatter>
          </ScatterChart>
        );
      case "combo":
        return (
          <ComposedChart data={data} margin={{ top: 4, right: 30, left: 24, bottom: 38 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey={xKey} fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="#6b7280" label={{ value: xKey, position: "insideBottom", offset: -18, fontSize: 10, fill: "#6b7280" }} />
            <YAxis yAxisId="left" fontSize={9} tickLine={false} axisLine={false} tickFormatter={fmt} stroke="#6b7280" />
            <YAxis yAxisId="right" orientation="right" fontSize={9} tickLine={false} axisLine={false} tickFormatter={fmt} stroke={PINNED_COLORS[3]} />
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [fmt(v)]} />
            <Legend iconSize={8} wrapperStyle={legendStyle} />
            <Bar yAxisId="left" dataKey={yKeys[0]} fill={PINNED_COLORS[0]} radius={[4, 4, 0, 0]} />
            {yKeys[1] && <Line yAxisId="right" type="monotone" dataKey={yKeys[1]} stroke={PINNED_COLORS[3]} strokeWidth={2} dot={{ r: 2 }} />}
          </ComposedChart>
        );
      case "funnel":
        return (
          <FunnelChart>
            <Funnel dataKey={yKeys[0]} data={data.map((d: any, i: number) => ({ ...d, fill: PINNED_COLORS[i % PINNED_COLORS.length] }))} isAnimationActive>
              <LabelList position="center" fill="#fff" stroke="none" fontSize={9} dataKey={xKey} />
            </Funnel>
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [fmt(v)]} />
          </FunnelChart>
        );
      case "radar":
        return (
          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
            <PolarGrid stroke="#e5e7eb" />
            <PolarAngleAxis dataKey={xKey} fontSize={9} stroke="#6b7280" />
            <PolarRadiusAxis fontSize={8} stroke="#6b7280" />
            <Radar dataKey={yKeys[0]} stroke={PINNED_COLORS[0]} fill={PINNED_COLORS[0]} fillOpacity={0.2} strokeWidth={2} />
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [fmt(v)]} />
          </RadarChart>
        );
      case "treemap":
        return (
          <Treemap
            data={data.map((d: any, i: number) => ({ ...d, name: d[xKey], fill: PINNED_COLORS[i % PINNED_COLORS.length] }))}
            dataKey={yKeys[0]}
            nameKey={xKey}
            aspectRatio={4 / 3}
            stroke="#fff"
          />
        );
      default:
        return (
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 24, bottom: 38 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey={xKey} fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="#6b7280" tickFormatter={dateTick} label={{ value: xKey, position: "insideBottom", offset: -18, fontSize: 10, fill: "#6b7280" }} />
            <YAxis fontSize={9} tickLine={false} axisLine={false} tickFormatter={fmt} stroke="#6b7280" label={{ value: yKeys[0], angle: -90, position: "insideLeft", offset: 0, fontSize: 10, fill: "#6b7280", style: { textAnchor: "middle" } }} />
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [fmt(v)]} />
            <Area type="monotone" dataKey={yKeys[0]} stroke={PINNED_COLORS[1]} strokeWidth={2} fill={PINNED_COLORS[1]} fillOpacity={0.15} />
          </AreaChart>
        );
    }
  };

  // For pie/donut/treemap the slice colour itself encodes the category, so
  // recharts' XAxis/YAxis label trick doesn't apply — render an explicit
  // colour-swatch legend below the chart so each colour has a name.
  const showCategoryLegend = type === "pie" || type === "donut" || type === "treemap";
  // Friendly subtitle so the reader knows what's being plotted even if the
  // chart's own axis labels are squeezed. E.g. "owner_count by membership_tier".
  const axesSummary =
    type === "table"
      ? null
      : showCategoryLegend
        ? `${yKeys[0]} by ${xKey}`
        : `X: ${xKey}  •  Y: ${yKeys.join(", ")}`;

  return (
    <>
    <Card className="shadow-sm group">
      <CardHeader className="pb-2 pt-4 px-4 cursor-pointer" title="Click to have the Copilot explain this chart" onClick={() => requestExplain({ title, kind: `${type} chart`, xKey, yKey, data })}>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          <ExplainButton onClick={() => setExplainOpen(true)} />
        </div>
        {axesSummary && (
          <CardDescription className="text-[10px] text-muted-foreground mt-0.5">{axesSummary}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className={showCategoryLegend ? "h-[200px]" : "h-[220px]"}>
          <ResponsiveContainer width="100%" height="100%">
            {renderPinnedInner() as any}
          </ResponsiveContainer>
        </div>
        {showCategoryLegend && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 pt-2 border-t border-border/40">
            {data.slice(0, 8).map((item: any, i: number) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: PINNED_COLORS[i % PINNED_COLORS.length] }} />
                <span className="text-muted-foreground truncate" title={String(item[xKey])}>{String(item[xKey])}</span>
                <span className="ml-auto text-foreground/70 font-medium tabular-nums">{fmt(Number(item[yKeys[0]]) || 0)}</span>
              </div>
            ))}
            {data.length > 8 && (
              <div className="text-[9px] text-muted-foreground/60 col-span-2 mt-0.5">+ {data.length - 8} more</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
    <ExplainPanel open={explainOpen} onOpenChange={setExplainOpen} context={explainCtx} />
    </>
  );
}

function ChartCard({ chart }: { chart: any }) {
  const [explainOpen, setExplainOpen] = useState(false);
  const { askCopilot } = useCopilot();
  // AI-decided colours for this chart (falls back to the default palette).
  // Shadows the module name so the renderers below pick up the chart's colours.
  const PALETTE = resolveColors(chart, DEFAULT_PALETTE);
  const rawData = chart.data || [];
  // node-postgres returns numeric columns as strings — coerce them so Recharts renders correctly.
  const data = rawData.map((row: any) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = typeof v === "string" && v !== "" && isFinite(Number(v)) ? Number(v) : v;
    }
    return out;
  });
  const xKey = chart.xKey || Object.keys(data[0] || {})[0] || "name";
  const rawYKey = chart.yKey || Object.keys(data[0] || {})[1] || "value";
  // Fix AI generation bug: when yKey === xKey, pick the first column that differs from xKey.
  const cols = data.length > 0 ? Object.keys(data[0]) : [];
  const yKey = Array.isArray(rawYKey) ? rawYKey
    : rawYKey !== xKey ? rawYKey
    : (cols.find(c => c !== xKey) ?? rawYKey);
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
            <XAxis dataKey={xKey} fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" tickFormatter={dateTick} />
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
            <XAxis dataKey={xKey} fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" tickFormatter={dateTick} />
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
            data={data.map((d: any, i: number) => ({ ...d, name: d[xKey], fill: PALETTE[i % PALETTE.length] }))}
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
            <XAxis dataKey={xKey} fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" tickFormatter={dateTick} />
            <YAxis fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatValue(v)} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatValue(v)]} />
            <Legend iconSize={8} wrapperStyle={{ fontSize: "10px" }} />
            {yKeys.map((k: string, i: number) => (
              <Area key={k} type="monotone" dataKey={k} stackId="1" stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.6} />
            ))}
          </AreaChart>
        );

      case "combo":
        return (
          <ComposedChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey={xKey} fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="hsl(var(--muted-foreground))" />
            <YAxis yAxisId="left" fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatValue(v)} />
            <YAxis yAxisId="right" orientation="right" fontSize={10} tickLine={false} axisLine={false} stroke={PALETTE[5]} tickFormatter={(v) => formatValue(v)} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatValue(v)]} />
            <Legend iconSize={8} wrapperStyle={{ fontSize: "10px" }} />
            <Bar yAxisId="left" dataKey={yKeys[0]} fill={PALETTE[0]} radius={[4, 4, 0, 0]} fillOpacity={0.85} />
            {yKeys[1] && <Line yAxisId="right" type="monotone" dataKey={yKeys[1]} stroke={PALETTE[5]} strokeWidth={2} dot={{ fill: PALETTE[5], r: 3 }} />}
          </ComposedChart>
        );

      case "funnel":
        return (
          <FunnelChart>
            <Funnel
              dataKey={yKeys[0]}
              data={data.map((d: any, i: number) => ({ ...d, fill: PALETTE[i % PALETTE.length] }))}
              isAnimationActive
            >
              <LabelList position="center" fill="#fff" stroke="none" fontSize={10} dataKey={xKey} />
            </Funnel>
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatValue(v)]} />
          </FunnelChart>
        );

      case "histogram":
        return (
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 20 }} barCategoryGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey={xKey} fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="hsl(var(--muted-foreground))" />
            <YAxis fontSize={10} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatValue(v)} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatValue(v)]} />
            <Bar dataKey={yKeys[0]} fill={PALETTE[2]} radius={[2, 2, 0, 0]} />
          </BarChart>
        );

      case "bullet":
        return <BulletChart data={data} nameKey={xKey} actualKey={yKeys[0]} targetKey={yKeys[1] || chart.config?.targetKey || ""} />;

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

  const isWide = ["treemap", "heatmap", "stacked-area", "stacked-bar", "waterfall", "scatter", "bubble", "combo", "funnel", "histogram"].includes(chart.type);

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
      <Card className={cn("shadow-sm hover:shadow-md transition-shadow group", isWide ? "col-span-2" : "")}>
        <CardHeader className="pb-1 cursor-pointer" title="Click to have the Copilot explain this chart" onClick={() => requestExplain({ title: chart.title, kind: `${chart.type} chart`, xKey, yKey: yKeys, data })}>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold text-foreground truncate">{chart.title}</CardTitle>
            <ExplainButton onClick={() => setExplainOpen(true)} />
          </div>
          {chart.subtitle && <CardDescription className="text-xs">{chart.subtitle}</CardDescription>}
        </CardHeader>
        <CardContent>
          <div className={cn("w-full", chart.type === "progress-bar" ? "" : "h-[280px]")}>
            {!hasData ? (
              <EmptyChartState message={chart.sqlError ? `Query failed: ${chart.sqlError}` : "No data available — click Refresh data to re-query the warehouse"} />
            ) : chart.type === "progress-bar" || chart.type === "gauge" || chart.type === "heatmap" || chart.type === "waterfall" || chart.type === "bullet" ? (
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
      return { name: d[xKey], value: val, start, end: cumulative, fill: i === data.length - 1 ? DEFAULT_PALETTE[0] : val >= 0 ? DEFAULT_PALETTE[4] : DEFAULT_PALETTE[14] };
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
                style={{ width: `${pct}%`, backgroundColor: DEFAULT_PALETTE[i % DEFAULT_PALETTE.length] }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BulletChart({ data, nameKey, actualKey, targetKey }: { data: any[]; nameKey: string; actualKey: string; targetKey: string }) {
  return (
    <div className="space-y-3 py-2">
      {data.slice(0, 8).map((d: any, i: number) => {
        const actual = Number(d[actualKey]) || 0;
        const target = targetKey ? Number(d[targetKey]) || 0 : 0;
        const max = Math.max(actual, target) * 1.15 || 1;
        const actualPct = Math.min((actual / max) * 100, 100);
        const targetPct = target ? Math.min((target / max) * 100, 100) : null;
        const onTrack = !target || actual >= target;
        return (
          <div key={i} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-foreground truncate">{d[nameKey]}</span>
              <span className="text-muted-foreground font-mono text-[10px]">
                {formatValue(actual)}{target ? ` / ${formatValue(target)}` : ""}
              </span>
            </div>
            <div className="h-5 bg-muted rounded relative overflow-hidden">
              <div
                className="h-full rounded transition-all duration-700"
                style={{ width: `${actualPct}%`, backgroundColor: onTrack ? DEFAULT_PALETTE[4] : DEFAULT_PALETTE[14] }}
              />
              {targetPct !== null && (
                <div className="absolute top-0 h-full w-[2px] bg-foreground/70" style={{ left: `${targetPct}%` }} />
              )}
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

// ---------------------------------------------------------------------------
// Slicer helpers — re-aggregate raw rows from dataScience when a filter is active
// ---------------------------------------------------------------------------

function sumByCategory(rows: any[], catCol: string, numCol: string, n = 10) {
  const b = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[catCol] ?? ""); if (!k) continue;
    const v = Number(r[numCol]); if (!isFinite(v)) continue;
    b.set(k, (b.get(k) ?? 0) + v);
  }
  return [...b.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, value]) => ({ name, value }));
}

function meanByCategory(rows: any[], catCol: string, numCol: string, n = 8) {
  const b = new Map<string, { sum: number; cnt: number }>();
  for (const r of rows) {
    const k = String(r[catCol] ?? ""); if (!k) continue;
    const v = Number(r[numCol]); if (!isFinite(v)) continue;
    const e = b.get(k) ?? { sum: 0, cnt: 0 }; e.sum += v; e.cnt++;
    b.set(k, e);
  }
  return [...b.entries()].map(([name, e]) => ({ name, value: e.sum / e.cnt }))
    .sort((a, b) => b.value - a.value).slice(0, n);
}

function countByCategory(rows: any[], catCol: string, n = 8) {
  const b = new Map<string, number>();
  for (const r of rows) { const k = String(r[catCol] ?? ""); if (k) b.set(k, (b.get(k) ?? 0) + 1); }
  return [...b.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, value]) => ({ name, value }));
}

function trendByMonthFn(rows: any[], dateCol: string, numCol: string) {
  const b = new Map<string, number>();
  for (const r of rows) {
    const dv = r[dateCol]; if (!dv) continue;
    const d = dv instanceof Date ? dv : new Date(String(dv)); if (isNaN(d.getTime())) continue;
    const v = Number(r[numCol]); if (!isFinite(v)) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    b.set(key, (b.get(key) ?? 0) + v);
  }
  return [...b.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([month, value]) => ({ month, value }));
}

function rebuildChartData(chart: any, rows: any[]): any[] | null {
  const tag: string = chart.insightTag ?? "";
  const parts = tag.split(":");
  switch (parts[0]) {
    case "top-sum":  return sumByCategory(rows, parts[1], parts[2], 10);
    case "mean":     return meanByCategory(rows, parts[1], parts[2], 8);
    case "mix":      return countByCategory(rows, parts[1], 8);
    case "trend":    return trendByMonthFn(rows, parts[1], parts[2]);
    case "corr": {
      const [, colA, colB] = parts;
      const out: any[] = [];
      for (const r of rows) {
        const x = Number(r[colA]); const y = Number(r[colB]);
        if (isFinite(x) && isFinite(y)) { out.push({ [colA]: x, [colB]: y }); if (out.length >= 200) break; }
      }
      return out.length > 0 ? out : null;
    }
    case "dist": {
      const col = parts[1];
      const vals: number[] = [];
      for (const r of rows) { const v = Number(r[col]); if (isFinite(v)) vals.push(v); }
      if (!vals.length) return null;
      let min = Infinity, max = -Infinity;
      for (const v of vals) { if (v < min) min = v; if (v > max) max = v; }
      if (min === max) return [{ name: String(min), value: vals.length }];
      const bins = 8;
      const w = (max - min) / bins;
      const counts = new Array<number>(bins).fill(0);
      for (const v of vals) counts[Math.min(bins - 1, Math.floor((v - min) / w))]++;
      const fmt = (n: number) => Math.abs(n) >= 1000 ? n.toFixed(0) : n.toFixed(1);
      return counts.map((c, i) => ({ name: `${fmt(min + i * w)}–${fmt(min + (i + 1) * w)}`, value: c }));
    }
    default: return null;
  }
}

interface GeneratedDashboardProps {
  config: any;
  /** Hide the "Present" toggle — used inside PresenterMode itself to avoid recursion. */
  hidePresenter?: boolean;
  /** Persist layout edits (Tidy button, Copilot actions) back to the source. */
  onConfigChange?: (next: any) => void;
}

export default function GeneratedDashboard({ config, hidePresenter, onConfigChange }: GeneratedDashboardProps) {
  const [presenting, setPresenting] = useState(false);
  const [slicerState, setSlicerState] = useState<Record<string, string>>({});

  if (!config) return null;

  const kpis = config.kpis || [];
  const charts = (config.charts || []).filter((c: any) => !c?.hidden);
  const tables = config.tables || [];
  const dsRows: any[] = config.dataScience?.rows ?? [];
  const dsCols: any[] = config.dataScience?.columns ?? [];

  // Detect slicer candidates: categorical columns from raw data with 2–20 unique values
  const slicerCols = useMemo(() => {
    if (!dsRows.length || !dsCols.length) return [];
    return dsCols
      .filter((c: any) => c.type === "string" || c.type === "boolean")
      .map((c: any) => {
        const vals = [...new Set(dsRows.map((r: any) => String(r[c.name] ?? "")).filter(Boolean))].sort();
        return { name: c.name, values: vals };
      })
      .filter((c) => c.values.length >= 2 && c.values.length <= 20)
      .slice(0, 3);
  }, [dsRows, dsCols]);

  const hasActiveSlicer = Object.values(slicerState).some((v) => v !== "");

  const filteredRows = useMemo(() => {
    if (!hasActiveSlicer) return dsRows;
    return dsRows.filter((row: any) =>
      Object.entries(slicerState).every(([key, val]) => !val || String(row[key] ?? "") === val),
    );
  }, [dsRows, slicerState, hasActiveSlicer]);

  const slicedCharts = useMemo(() => {
    // Recovery pass: rebuild any chart that has empty data from the raw dataset rows.
    const recovered = dsRows.length > 0 ? charts.map((chart: any) => {
      if (Array.isArray(chart.data) && chart.data.length > 0) return chart;
      const rebuilt = rebuildChartData(chart, dsRows);
      if (rebuilt && rebuilt.length > 0) return { ...chart, data: rebuilt };
      // Generic fallback when insightTag is absent: aggregate by xKey / yKey.
      const xKey: string | undefined = chart.xKey;
      const yKeyRaw = Array.isArray(chart.yKey) ? chart.yKey[0] : chart.yKey;
      const yKey: string | undefined = yKeyRaw;
      if (!xKey) return chart;
      const availCols = Object.keys(dsRows[0]);
      const rx = availCols.find((c) => c === xKey) ?? availCols.find((c) => c.includes(xKey));
      if (!rx) return chart;
      const ry = yKey ? (availCols.find((c) => c === yKey) ?? availCols.find((c) => c.includes(yKey))) : undefined;
      const agg: Record<string, number> = {};
      for (const row of dsRows) {
        const k = String(row[rx] ?? ""); if (!k) continue;
        agg[k] = (agg[k] ?? 0) + (ry ? Number(row[ry] || 0) : 1);
      }
      const limit = chart.type === "pie" || chart.type === "donut" ? 8 : 10;
      const derived = Object.entries(agg)
        .sort(([, a], [, b]) => b - a)
        .slice(0, limit)
        .map(([k, v]) => ({ [rx]: k, [ry ?? "count"]: v }));
      return derived.length > 0 ? { ...chart, data: derived, xKey: rx, yKey: ry ?? "count" } : chart;
    }) : charts;

    if (!hasActiveSlicer) return recovered;
    return recovered.map((chart: any) => {
      // insightTag path: re-aggregate from raw filtered rows
      if (filteredRows.length) {
        const rebuilt = rebuildChartData(chart, filteredRows);
        if (rebuilt && rebuilt.length > 0) return { ...chart, data: rebuilt };
      }
      // direct-filter fallback: filter chart.data by any slicer columns present in it
      const activeSlicers = Object.entries(slicerState).filter(([, v]) => v !== "");
      if (!activeSlicers.length) return chart;
      const chartCols = new Set(Object.keys((chart.data || [])[0] || {}));
      const relevant = activeSlicers.filter(([k]) => chartCols.has(k));
      if (!relevant.length) return chart;
      const filtered = (chart.data || []).filter((row: any) =>
        relevant.every(([k, v]) => String(row[k] ?? "") === v)
      );
      return filtered.length > 0 ? { ...chart, data: filtered } : chart;
    });
  }, [charts, dsRows, filteredRows, hasActiveSlicer, slicerState]);

  const kpiStaggerEnd = kpis.length * 70;
  const canEdit = typeof onConfigChange === "function";

  // Charts pinned from the Copilot chat ("Add to Dashboard" button)
  const [location] = useLocation();
  const { getChartsForSection } = useCustomDashboards();
  const pinnedCharts = getChartsForSection(location);

  // Tell the right-rail Copilot what we're showing so it can answer with
  // ground-truth context (chart titles, KPI labels) instead of generic prose.
  useRegisterObservation(hidePresenter ? null : {
    label: config.title || "Generated dashboard",
    kind: "dashboard",
    summary: `Dashboard "${config.title}" with ${kpis.length} KPIs and ${charts.length} charts. KPIs: ${kpis.map((k: any) => k.label).join(", ")}. Charts: ${charts.map((c: any) => `${c.title} (${c.type})`).join("; ")}.`,
    suggestions: [
      `What's the headline insight on "${config.title}"?`,
      charts[0] ? `Explain the "${charts[0].title}" chart` : "Explain the trends",
      "Which KPI deserves the most attention right now?",
      kpis[0] ? `Is the ${kpis[0].label} good or bad versus benchmark?` : "Are these numbers normal?",
    ].filter(Boolean) as string[],
  });

  return (
    <div className="space-y-5">
      {/* Hero title/Present bar — only on standalone dashboards. Inside a project
          the page header already names the project + dashboard, so we drop it
          (and the Refresh row) to give the KPIs/charts the full space. */}
      {!hidePresenter && (
      <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-primary/5 via-background to-background p-5 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="absolute -top-12 -right-12 w-40 h-40 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-foreground tracking-tight">{config.title || "Generated Dashboard"}</h1>
            {config.subtitle && <p className="text-sm text-muted-foreground mt-0.5">{config.subtitle}</p>}
          </div>
          {!hidePresenter && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onConfigChange!(autoTidy(config))}
                  className="gap-1.5 h-8 text-xs bg-card hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors"
                  data-testid="tidy-layout-button"
                  title="Auto-arrange charts: trends full-width, comparisons paired, scatters expanded"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  Tidy
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPresenting(true)}
                className="gap-1.5 h-8 text-xs bg-card hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors"
                data-testid="presenter-mode-button"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                Present
              </Button>
            </div>
          )}
        </div>
      </div>
      )}

      {kpis.length > 0 && (
        <div className={cn("grid gap-4", kpis.length <= 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4")}>
          {kpis.map((kpi: any, i: number) => (
            <KPICard key={i} kpi={kpi} index={i} />
          ))}
        </div>
      )}

      {/* Power BI-style slicer bar — auto-detected from raw data columns */}
      {slicerCols.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/40 border border-border rounded-xl flex-wrap animate-in fade-in duration-300">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Filter</span>
          </div>
          {slicerCols.map((col) => (
            <div key={col.name} className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground font-medium">{col.name}:</span>
              <select
                value={slicerState[col.name] ?? ""}
                onChange={(e) =>
                  setSlicerState((prev) => ({ ...prev, [col.name]: e.target.value }))
                }
                className="text-[11px] bg-white border border-border rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer hover:border-primary/50 transition-colors"
              >
                <option value="">All</option>
                {col.values.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          ))}
          {hasActiveSlicer && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[10px] text-primary font-semibold">
                {filteredRows.length.toLocaleString()} / {dsRows.length.toLocaleString()} rows
              </span>
              <button
                onClick={() => setSlicerState({})}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            </div>
          )}
        </div>
      )}

      {/* grid-flow-row-dense packs half-width charts into the gaps left by
          full-width ones, so same-size charts (e.g. the distribution pies) sit
          adjacent instead of scattered with holes between them. */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 grid-flow-row-dense">
        {slicedCharts.map((chart: any, i: number) => {
          // Span both columns for inherently-wide chart types, and for cartesian
          // charts with many categories (their x-axis labels need the room) —
          // keeps dense charts readable instead of cramped half-width.
          const WIDE_TYPES = ["treemap", "heatmap", "stacked-area", "stacked-bar", "waterfall", "scatter", "bubble", "combo", "funnel", "histogram"];
          const CARTESIAN = ["bar", "line", "area", "histogram", "stacked-bar", "stacked-area", "combo"];
          const manyCategories = Array.isArray(chart.data) && chart.data.length > 10 && CARTESIAN.includes(chart.type);
          const wide = chart.colSpan === 2 || WIDE_TYPES.includes(chart.type) || manyCategories;
          return (
            <div
              key={chart.id}
              className={cn(
                "animate-in fade-in slide-in-from-bottom-3 duration-500",
                wide && "xl:col-span-2",
              )}
              style={{ animationDelay: `${kpiStaggerEnd + i * 80}ms`, animationFillMode: "both" }}
            >
              <ChartCard chart={chart} />
            </div>
          );
        })}
      </div>

      {pinnedCharts.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Pinned from Chat
          </p>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            {pinnedCharts.map((chart) => (
              <PinnedChart key={chart.id} chart={chart} />
            ))}
          </div>
        </div>
      )}

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

      {/* Data-Scientist agent surface — only renders when the dataset has
          enough rows / columns / variance to be worth it. The fitness gate
          and all the heavy compute live inside the panel itself. */}
      {config.dataScience?.rows?.length > 0 && (
        <AdvancedAnalytics
          rows={config.dataScience.rows}
          columns={config.dataScience.columns ?? []}
          defaultOpen={!!config.dataScience.defaultOpen}
        />
      )}

      {presenting && (
        <Suspense fallback={null}>
          <PresenterMode
            config={config}
            onClose={() => setPresenting(false)}
            onConfigChange={onConfigChange}
          />
        </Suspense>
      )}
    </div>
  );
}
