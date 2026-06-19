// Multi-series time chart for the dashboard (log volume by file, auth failed vs
// accepted, etc.). Dark NOC styling; stacked area or line.

import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

const SERIES_COLORS = ["#22d3ee", "#34d399", "#f59e0b", "#f43f5e", "#a78bfa", "#38bdf8", "#facc15", "#fb7185"];

const TOOLTIP_STYLE = {
  backgroundColor: "hsl(222 44% 12%)", borderColor: "hsl(218 32% 24%)",
  borderRadius: "8px", fontSize: "11px", color: "hsl(210 40% 96%)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
} as const;

function fmt(v: number) {
  if (!isFinite(v)) return String(v);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
}
function shortTime(label: string) {
  // label is a locale datetime string; keep the time-ish tail compact.
  const d = new Date(label);
  return isNaN(d.getTime()) ? label : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export interface TimeSeriesChartProps {
  rows: Array<Record<string, unknown>>;
  keys: string[];
  type?: "area" | "line";
  height?: number;
  stacked?: boolean;
  colors?: string[];
  legendNames?: Record<string, string>;
}

export default function TimeSeriesChart({ rows, keys, type = "area", height = 220, stacked, colors, legendNames }: TimeSeriesChartProps) {
  const palette = colors ?? SERIES_COLORS;
  if (!rows || rows.length === 0) {
    return <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>No data in this range.</div>;
  }
  const axisProps = { fontSize: 10, tickLine: false, axisLine: false, stroke: "hsl(var(--muted-foreground))" } as const;
  // Compact per-series summary (start/end/peak/low over N points), exposed so the
  // "Explain" gesture sends real trend figures to the chat rather than unreadable
  // SVG axis text. See readVisualValues in lib/ui-bridge.
  const explainValues = keys
    .map((k) => {
      const vals = rows.map((r) => Number(r[k])).filter((v) => isFinite(v));
      if (!vals.length) return `${legendNames?.[k] ?? k}: no data`;
      const name = legendNames?.[k] ?? k;
      return `${name}: start ${vals[0]}, end ${vals[vals.length - 1]}, peak ${Math.max(...vals)}, low ${Math.min(...vals)} (${vals.length} pts)`;
    })
    .join("; ");
  // Redraw spec for the chat (single-series line of the first key). See
  // readVisualChart + the renderClickedVisual action.
  const tsKey = keys[0];
  const explainChart = tsKey
    ? JSON.stringify({
        type: type === "area" ? "area" : "line", xKey: "time", yKey: tsKey,
        data: rows.slice(-60).map((r) => ({ time: r.time, [tsKey]: r[tsKey] })),
      })
    : undefined;
  return (
    <div className="w-full" style={{ height }} data-explain-values={explainValues} data-explain-chart={explainChart}>
      <ResponsiveContainer width="100%" height="100%">
        {type === "line" ? (
          <LineChart data={rows} margin={{ top: 5, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="time" tickFormatter={shortTime} minTickGap={40} {...axisProps} />
            <YAxis tickFormatter={fmt} allowDecimals={false} width={36} {...axisProps} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={shortTime} />
            <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => legendNames?.[v] ?? v} />
            {keys.map((k, i) => (
              <Line key={k} type="monotone" dataKey={k} stroke={palette[i % palette.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        ) : (
          <AreaChart data={rows} margin={{ top: 5, right: 12, left: 4, bottom: 4 }}>
            <defs>
              {keys.map((k, i) => (
                <linearGradient key={k} id={`ts-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={palette[i % palette.length]} stopOpacity={0.5} />
                  <stop offset="95%" stopColor={palette[i % palette.length]} stopOpacity={0.04} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="time" tickFormatter={shortTime} minTickGap={40} {...axisProps} />
            <YAxis tickFormatter={fmt} allowDecimals={false} width={36} {...axisProps} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={shortTime} />
            <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => legendNames?.[v] ?? v} />
            {keys.map((k, i) => (
              <Area
                key={k} type="monotone" dataKey={k}
                stackId={stacked ? "1" : undefined}
                stroke={palette[i % palette.length]} strokeWidth={2}
                fill={`url(#ts-grad-${i})`} fillOpacity={1}
              />
            ))}
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
