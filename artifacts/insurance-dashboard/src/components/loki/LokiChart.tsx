// Reusable Recharts renderer for Loki visuals — used both inline in the
// CopilotKit chat (the `pinLokiVisual` action's render) and in the Loki Logs
// "Pinned Visuals" subtab. Mirrors the styling of custom-charts-section.tsx but
// formats values as plain counts (log volumes, not currency).

import {
  ResponsiveContainer,
  BarChart, Bar,
  AreaChart, Area,
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

const CHART_COLORS = ["#1565C0", "#0288D1", "#0097A7", "#00838F", "#00695C", "#6366f1", "#8b5cf6"];

// Severity-aware palette so critical/warning/info read intuitively when the
// x-axis is a severity. Falls back to the default palette per index.
const SEVERITY_COLORS: Record<string, string> = {
  critical: "#dc2626",
  error: "#dc2626",
  warning: "#f59e0b",
  warn: "#f59e0b",
  info: "#2563eb",
  debug: "#6b7280",
};

function formatCount(val: number) {
  if (!isFinite(val)) return String(val);
  if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toLocaleString();
}

const TOOLTIP_STYLE = {
  backgroundColor: "#fff",
  borderColor: "#e5e7eb",
  borderRadius: "8px",
  fontSize: "12px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
} as const;

export interface LokiChartProps {
  type: string;
  xKey: string;
  yKey: string;
  data: Array<Record<string, unknown>>;
  colors?: string[];
  height?: number;
}

function colorFor(row: Record<string, unknown>, xKey: string, i: number, palette?: string[]) {
  if (palette && palette[i]) return palette[i];
  const key = String(row?.[xKey] ?? "").toLowerCase();
  return SEVERITY_COLORS[key] ?? CHART_COLORS[i % CHART_COLORS.length];
}

export default function LokiChart({ type, xKey, yKey, data, colors, height = 240 }: LokiChartProps) {
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>
        No data to plot.
      </div>
    );
  }

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {type === "pie" ? (
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2} dataKey={yKey} nameKey={xKey}>
              {data.map((row, i) => <Cell key={i} fill={colorFor(row, xKey, i, colors)} />)}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [formatCount(v)]} />
          </PieChart>
        ) : type === "line" ? (
          <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 25 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey={xKey} fontSize={10} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="hsl(var(--muted-foreground))" />
            <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={formatCount} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [formatCount(v)]} />
            <Line type="monotone" dataKey={yKey} stroke={colors?.[0] ?? CHART_COLORS[0]} strokeWidth={2} dot={{ fill: colors?.[0] ?? CHART_COLORS[0], r: 2 }} />
          </LineChart>
        ) : type === "area" ? (
          <AreaChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 25 }}>
            <defs>
              <linearGradient id="loki-area-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors?.[0] ?? CHART_COLORS[1]} stopOpacity={0.3} />
                <stop offset="95%" stopColor={colors?.[0] ?? CHART_COLORS[1]} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey={xKey} fontSize={10} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="hsl(var(--muted-foreground))" />
            <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={formatCount} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [formatCount(v)]} />
            <Area type="monotone" dataKey={yKey} stroke={colors?.[0] ?? CHART_COLORS[1]} strokeWidth={2} fillOpacity={1} fill="url(#loki-area-grad)" />
          </AreaChart>
        ) : (
          <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 25 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey={xKey} fontSize={10} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="hsl(var(--muted-foreground))" />
            <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={formatCount} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [formatCount(v)]} />
            <Bar dataKey={yKey} radius={[4, 4, 0, 0]}>
              {data.map((row, i) => <Cell key={i} fill={colorFor(row, xKey, i, colors)} />)}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
