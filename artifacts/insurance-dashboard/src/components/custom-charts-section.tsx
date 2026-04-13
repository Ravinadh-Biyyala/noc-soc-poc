import { useCustomDashboards, CustomChart } from "@/lib/custom-dashboards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, Sparkles } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart, Bar,
  AreaChart, Area,
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

const CHART_COLORS = ["#1565C0", "#0288D1", "#0097A7", "#00838F", "#00695C", "#6366f1", "#8b5cf6"];

function formatValue(val: number) {
  if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
  if (val >= 1000) return `$${(val / 1000).toFixed(0)}K`;
  if (val < 1 && val > 0) return `${(val * 100).toFixed(1)}%`;
  return val.toLocaleString();
}

function DashboardChart({ chart, onRemove }: { chart: CustomChart; onRemove: () => void }) {
  const { type, title, xKey, yKey, data } = chart;

  return (
    <Card className="shadow-sm group relative">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500"
          onClick={onRemove}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            {type === 'pie' ? (
              <PieChart>
                <Pie data={data} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2} dataKey={yKey} nameKey={xKey}>
                  {data.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#fff', borderColor: '#e5e7eb', borderRadius: '8px', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} formatter={(v: number) => [formatValue(v)]} />
              </PieChart>
            ) : type === 'bar' ? (
              <BarChart data={data} margin={{ top: 5, right: 10, left: 15, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey={xKey} fontSize={10} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="hsl(var(--muted-foreground))" />
                <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={formatValue} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ backgroundColor: '#fff', borderColor: '#e5e7eb', borderRadius: '8px', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} formatter={(v: number) => [formatValue(v)]} />
                <Bar dataKey={yKey} radius={[4, 4, 0, 0]}>
                  {data.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            ) : type === 'line' ? (
              <LineChart data={data} margin={{ top: 5, right: 10, left: 15, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey={xKey} fontSize={10} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="hsl(var(--muted-foreground))" />
                <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={formatValue} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ backgroundColor: '#fff', borderColor: '#e5e7eb', borderRadius: '8px', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} formatter={(v: number) => [formatValue(v)]} />
                <Line type="monotone" dataKey={yKey} stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ fill: CHART_COLORS[0], r: 3 }} />
              </LineChart>
            ) : (
              <AreaChart data={data} margin={{ top: 5, right: 10, left: 15, bottom: 25 }}>
                <defs>
                  <linearGradient id={`grad-${chart.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS[1]} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS[1]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey={xKey} fontSize={10} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="hsl(var(--muted-foreground))" />
                <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={formatValue} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ backgroundColor: '#fff', borderColor: '#e5e7eb', borderRadius: '8px', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} formatter={(v: number) => [formatValue(v)]} />
                <Area type="monotone" dataKey={yKey} stroke={CHART_COLORS[1]} strokeWidth={2} fillOpacity={1} fill={`url(#grad-${chart.id})`} />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
        {type === 'pie' && (
          <div className="grid grid-cols-3 gap-1.5 mt-2">
            {data.slice(0, 6).map((item: any, i: number) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                <span className="text-muted-foreground truncate">{item[xKey]}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function CustomChartsSection({ section }: { section: string }) {
  const { getChartsForSection, removeChart } = useCustomDashboards();
  const charts = getChartsForSection(section);

  if (charts.length === 0) return null;

  return (
    <div className="space-y-4 mt-5">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">AI-Generated Insights</h3>
        <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{charts.length} chart{charts.length > 1 ? 's' : ''}</span>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {charts.map(chart => (
          <DashboardChart key={chart.id} chart={chart} onRemove={() => removeChart(chart.id)} />
        ))}
      </div>
    </div>
  );
}
