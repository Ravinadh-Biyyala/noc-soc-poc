import { useGetDashboardSection, getGetDashboardSectionQueryKey } from "@workspace/api-client-react";
import { useTenantConfig, resolveIcon, type SectionConfig } from "@/lib/tenant-config";
import { useCopilot } from "@/lib/copilot-context";
import CustomChartsSection from "@/components/custom-charts-section";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import { AnimatedNumber } from "@/lib/animated-number";
import { TrendingUp, TrendingDown } from "lucide-react";
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableBody,
} from "@/components/ui/table";
import {
  ResponsiveContainer,
  AreaChart, Area,
  BarChart, Bar,
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import USAMap from "@/components/USAMap";

const FUNNEL_COLORS = ["#c7d2fe", "#93a7f8", "#6480f0", "#3b5de7", "#1a3fd0"];

const CHART_COLORS = [
  "hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))",
  "hsl(var(--chart-4))", "hsl(var(--chart-5))", "#6366f1", "#8b5cf6",
];

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce((acc: unknown, key: string) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function formatValue(value: unknown, format: string): string {
  if (value === undefined || value === null) return "—";
  const num = Number(value);
  if (isNaN(num)) return String(value);
  switch (format) {
    case "currency": return formatCurrencyCompact(num);
    case "percent": return formatPercent(num);
    case "number": return formatNumberCompact(num);
    default: return String(value);
  }
}

// Abbreviate large currency so KPI cards never clip.
// $267,800,000 -> "$267.8M", $1,250,000,000 -> "$1.25B".
// Smaller values keep full precision since they fit comfortably.
function formatCurrencyCompact(num: number): string {
  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e5) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return formatCurrency(num);
}

function formatNumberCompact(num: number): string {
  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  return formatNumber(num);
}

function ConfigKPICard({
  label, value, format, icon, changeValue, copilotQuestion, variant, index = 0,
}: {
  label: string; value: unknown; format: string; icon: string;
  changeValue?: number; copilotQuestion: string; variant: "primary" | "secondary";
  index?: number;
}) {
  const { askCopilot } = useCopilot();
  const Icon = resolveIcon(icon);
  const formatted = formatValue(value, format);
  const isNumeric = typeof value === "number" && !isNaN(value);
  const numericValue = isNumeric ? (value as number) : 0;
  const isPositive = changeValue !== undefined && changeValue > 0;
  // Stagger entrance — each card animates in 70ms after the previous one.
  const animStyle = { animationDelay: `${index * 70}ms`, animationFillMode: "both" as const };

  if (variant === "secondary") {
    const isAlert = format === "percent" && typeof value === "number" && label.toLowerCase().includes("loss") && value > 0.5;
    return (
      <Card
        className="shadow-sm cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 duration-500"
        style={animStyle}
        onClick={() => askCopilot(copilotQuestion)}
      >
        <CardContent className="p-3 flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${isAlert ? 'bg-red-50 text-red-500' : 'bg-primary/8 text-primary'}`}>
            <Icon className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground truncate">{label}</p>
            <p className={`text-sm font-bold tabular-nums ${isAlert ? 'text-red-500' : changeValue && changeValue > 0 ? 'text-emerald-600' : 'text-foreground'}`}>
              {isNumeric ? <AnimatedNumber value={numericValue} format={(n) => formatValue(n, format)} /> : formatted}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group animate-in fade-in slide-in-from-bottom-3 duration-500"
      style={animStyle}
      onClick={() => askCopilot(copilotQuestion)}
    >
      <CardContent className="p-4 relative overflow-hidden">
        <div className="flex justify-between items-start mb-2 gap-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider truncate">{label}</p>
          <div className="w-7 h-7 rounded-md bg-primary/8 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/15 transition-colors">
            <Icon className="w-3.5 h-3.5 text-primary" />
          </div>
        </div>
        <p className="text-xl font-bold text-foreground mb-0.5 tabular-nums truncate">
          {isNumeric ? <AnimatedNumber value={numericValue} format={(n) => formatValue(n, format)} /> : formatted}
        </p>
        {changeValue !== undefined && (
          <div className={`flex items-center gap-1 text-[10px] font-medium ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {isPositive ? '+' : ''}{changeValue.toFixed(1)}% YoY
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConfigChart({
  chart, data,
}: {
  chart: SectionConfig["charts"][0];
  data: unknown[];
}) {
  if (!data || !Array.isArray(data) || data.length === 0) return null;

  const { type, title, xKey, yKeys } = chart;
  const primaryYKey = yKeys[0]?.key || "value";

  const chartFormatter = (val: number) => {
    if (val >= 1000000) return `$${(val / 1000000).toFixed(0)}M`;
    if (val >= 1000) return `$${(val / 1000).toFixed(0)}K`;
    if (val < 1 && val > 0) return `${(val * 100).toFixed(0)}%`;
    return val.toLocaleString();
  };

  const tooltipStyle = {
    backgroundColor: '#fff',
    borderColor: 'hsl(var(--border))',
    borderRadius: '8px',
    fontSize: '12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  };

  if (type === "pie") {
    return (
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[220px] flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%" cy="50%"
                  innerRadius={50} outerRadius={80}
                  paddingAngle={2}
                  dataKey={primaryYKey}
                  nameKey={xKey}
                >
                  {data.map((_: unknown, i: number) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatCurrency(v)]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-1.5 mt-1">
            {data.slice(0, 6).map((item: Record<string, unknown>, i: number) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i] }} />
                <span className="text-muted-foreground truncate">{String(item[xKey] || '')}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const isStacked = yKeys.length > 1;
  const gradientId = `grad-${chart.id}`;

  if (type === "area") {
    return (
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                <defs>
                  {yKeys.map((yk, i) => (
                    <linearGradient key={yk.key} id={`${gradientId}-${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.02} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey={xKey} stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={chartFormatter} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [chartFormatter(v), name]} />
                {isStacked && <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '10px' }} />}
                {yKeys.map((yk, i) => (
                  <Area
                    key={yk.key}
                    type="monotone"
                    dataKey={yk.key}
                    name={yk.label}
                    stackId={isStacked ? "1" : undefined}
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    strokeWidth={2}
                    fillOpacity={isStacked ? 0.7 : 1}
                    fill={isStacked ? CHART_COLORS[i % CHART_COLORS.length] : `url(#${gradientId}-${i})`}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (type === "bar") {
    return (
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 10, right: 10, left: 20, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey={xKey} stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} angle={-20} textAnchor="end" />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={chartFormatter} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [chartFormatter(v)]} />
                <Bar dataKey={primaryYKey} radius={[4, 4, 0, 0]}>
                  {data.map((_: unknown, i: number) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (type === "line") {
    return (
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey={xKey} stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={chartFormatter} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [chartFormatter(v)]} />
                {yKeys.map((yk, i) => (
                  <Line key={yk.key} type="monotone" dataKey={yk.key} name={yk.label} stroke={CHART_COLORS[i]} strokeWidth={2} dot={{ fill: CHART_COLORS[i], r: 3 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}

function ConfigTable({
  table, data,
}: {
  table: SectionConfig["tables"][0];
  data: unknown[];
}) {
  const { askCopilot } = useCopilot();
  if (!data || !Array.isArray(data) || data.length === 0) return null;

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{table.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                {table.columns.map((col) => (
                  <TableHead
                    key={col.key}
                    className={`text-xs font-medium text-muted-foreground ${col.format !== "text" ? "text-right" : ""}`}
                  >
                    {col.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row: Record<string, unknown>, i: number) => {
                const firstTextCol = table.columns.find(c => c.format === "text");
                const rowLabel = firstTextCol ? String(row[firstTextCol.key] || '') : '';
                const question = table.copilotQuestionTemplate
                  ? table.copilotQuestionTemplate.replace(/\{(\w+)\}/g, (_, k) => String(row[k] || k))
                  : `Analyze ${rowLabel} in detail`;

                return (
                  <TableRow
                    key={i}
                    className={`${i % 2 === 1 ? 'bg-muted/20' : ''} cursor-pointer hover:bg-primary/5`}
                    onClick={() => askCopilot(question)}
                  >
                    {table.columns.map((col) => {
                      const val = row[col.key];
                      const isFirst = col === table.columns[0];
                      return (
                        <TableCell
                          key={col.key}
                          className={`text-sm ${
                            col.format !== "text" ? "text-right" : ""
                          } ${
                            isFirst ? "font-medium text-foreground" : ""
                          } ${
                            col.format === "currency" ? "text-primary font-mono font-medium" : ""
                          } ${
                            col.format === "percent" ? "font-medium" : ""
                          }`}
                        >
                          {col.format === "percent" && typeof val === "number" && val > 0.55 && col.key.toLowerCase().includes("loss") ? (
                            <span className="text-red-500">{formatValue(val, col.format)}</span>
                          ) : col.format === "percent" && typeof val === "number" ? (
                            <Badge variant="outline" className={`text-[10px] ${
                              val > 0 && col.key.toLowerCase().includes("change") || col.key.toLowerCase().includes("yoy")
                                ? val > 0 ? "text-emerald-600 border-emerald-200 bg-emerald-50" : "text-red-500 border-red-200 bg-red-50"
                                : ""
                            }`}>
                              {formatValue(val, col.format)}
                            </Badge>
                          ) : (
                            formatValue(val, col.format)
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function FunnelWidget({ title, data }: { title: string; data: unknown[] }) {
  if (!data || !Array.isArray(data) || data.length === 0) return null;
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <CardDescription className="text-xs">Lead to Bind conversion</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
              <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis dataKey="stage" type="category" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} width={65} />
              <Tooltip
                contentStyle={{ backgroundColor: '#fff', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                formatter={(value: number) => [formatNumber(value), 'Count']}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {data.map((_: unknown, index: number) => (
                  <Cell key={index} fill={FUNNEL_COLORS[index % FUNNEL_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function RecentItemsWidget({ title, data }: { title: string; data: unknown[] }) {
  const { askCopilot } = useCopilot();
  if (!data || !Array.isArray(data) || data.length === 0) return null;

  const items = data as Array<Record<string, unknown>>;
  const keys = Object.keys(items[0] || {});

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <CardDescription className="text-xs">Latest activity</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                {keys.map((key) => (
                  <TableHead key={key} className="text-xs font-medium text-muted-foreground">
                    {key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, i) => (
                <TableRow
                  key={i}
                  className={`${i % 2 === 1 ? 'bg-muted/20' : ''} cursor-pointer hover:bg-primary/5`}
                  onClick={() => askCopilot(`Tell me about ${String(item[keys[0]] || '')} — ${keys.slice(1).map(k => `${k}: ${String(item[k] || '')}`).join(', ')}`)}
                >
                  {keys.map((key) => {
                    const val = item[key];
                    const isStatus = key.toLowerCase() === 'status';
                    const isId = key.toLowerCase().includes('id');
                    const isMoney = typeof val === 'number' && val > 1000;
                    return (
                      <TableCell key={key} className={`text-sm ${isId ? 'font-mono text-xs text-primary font-medium' : ''} ${isMoney ? 'text-right font-mono font-medium' : ''}`}>
                        {isStatus ? (
                          <Badge variant="outline" className={`text-[10px] ${
                            val === 'Open' ? 'text-amber-600 border-amber-200 bg-amber-50' :
                            val === 'Under Review' ? 'text-blue-600 border-blue-200 bg-blue-50' :
                            'text-emerald-600 border-emerald-200 bg-emerald-50'
                          }`}>
                            {String(val)}
                          </Badge>
                        ) : isMoney ? (
                          formatCurrency(val as number)
                        ) : (
                          String(val ?? '')
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardSection({ sectionId }: { sectionId: string }) {
  const { config } = useTenantConfig();
  const section = config?.sections.find((s) => s.id === sectionId);

  const { data, isLoading } = useGetDashboardSection(sectionId, {
    query: { enabled: !!section, queryKey: getGetDashboardSectionQueryKey(sectionId) },
  });

  if (!section) {
    return <div className="p-6 text-muted-foreground">Section not found</div>;
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(Math.min(section.kpis.length, 4))].map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[400px] rounded-xl" />
      </div>
    );
  }

  const sectionData = data as Record<string, unknown>;
  const primaryKpis = section.kpis.slice(0, 4);
  const secondaryKpis = section.kpis.slice(4);

  const hasUsaMap = section.widgets.some((w) => w.type === "usa-map");
  const funnelWidget = section.widgets.find((w) => w.type === "funnel");
  const recentItemsWidget = section.widgets.find((w) => w.type === "recent-items");

  const chartsWithoutMap = section.charts;
  const chartCount = chartsWithoutMap.length;

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {primaryKpis.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {primaryKpis.map((kpi, i) => (
            <ConfigKPICard
              key={kpi.id}
              index={i}
              label={kpi.label}
              value={getNestedValue(sectionData, kpi.dataKey)}
              format={kpi.format}
              icon={kpi.icon}
              changeValue={kpi.changeKey ? Number(getNestedValue(sectionData, kpi.changeKey)) || undefined : undefined}
              copilotQuestion={kpi.copilotQuestion}
              variant="primary"
            />
          ))}
        </div>
      )}

      {secondaryKpis.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {secondaryKpis.map((kpi, i) => (
            <ConfigKPICard
              key={kpi.id}
              index={primaryKpis.length + i}
              label={kpi.label}
              value={getNestedValue(sectionData, kpi.dataKey)}
              format={kpi.format}
              icon={kpi.icon}
              copilotQuestion={kpi.copilotQuestion}
              variant="secondary"
            />
          ))}
        </div>
      )}

      {funnelWidget ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <FunnelWidget
              title={funnelWidget.title}
              data={sectionData[funnelWidget.dataKey] as unknown[]}
            />
            {chartCount > 0 && (
              <div className="lg:col-span-2">
                <ConfigChart chart={chartsWithoutMap[0]} data={sectionData[chartsWithoutMap[0].dataKey] as unknown[]} />
              </div>
            )}
          </div>
          {chartCount > 1 && (
            <div className={`grid grid-cols-1 ${chartCount > 2 ? "xl:grid-cols-2" : ""} gap-5`}>
              {chartsWithoutMap.slice(1).map((chart) => (
                <div key={chart.id}>
                  <ConfigChart chart={chart} data={sectionData[chart.dataKey] as unknown[]} />
                </div>
              ))}
            </div>
          )}
        </>
      ) : chartCount > 0 ? (
        <div className={`grid grid-cols-1 ${chartCount >= 2 ? 'xl:grid-cols-3' : ''} gap-5`}>
          {chartsWithoutMap.map((chart, idx) => {
            const chartData = sectionData[chart.dataKey];
            const span = idx === 0 && chartCount >= 2 ? "xl:col-span-2" : "";
            return (
              <div key={chart.id} className={span}>
                <ConfigChart chart={chart} data={chartData as unknown[]} />
              </div>
            );
          })}
        </div>
      ) : null}

      {hasUsaMap && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <Card className="xl:col-span-2 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground">Geographic Performance</CardTitle>
              <CardDescription className="text-xs">Written premium by state -- hover for details</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <USAMap />
            </CardContent>
          </Card>
          {section.tables.length > 0 && (
            <div>
              <ConfigTable
                table={section.tables[0]}
                data={sectionData[section.tables[0].dataKey] as unknown[]}
              />
            </div>
          )}
        </div>
      )}

      {!hasUsaMap && section.tables.length > 0 && (
        <div className={`grid grid-cols-1 ${section.tables.length >= 2 ? "xl:grid-cols-2" : ""} gap-5`}>
          {section.tables.map((table) => (
            <ConfigTable
              key={table.id}
              table={table}
              data={sectionData[table.dataKey] as unknown[]}
            />
          ))}
        </div>
      )}

      {hasUsaMap && section.tables.length > 1 && (
        <div className={`grid grid-cols-1 ${section.tables.length > 2 ? "xl:grid-cols-2" : ""} gap-5`}>
          {section.tables.slice(1).map((table) => (
            <ConfigTable
              key={table.id}
              table={table}
              data={sectionData[table.dataKey] as unknown[]}
            />
          ))}
        </div>
      )}

      {recentItemsWidget && (
        <RecentItemsWidget
          title={recentItemsWidget.title}
          data={sectionData[recentItemsWidget.dataKey] as unknown[]}
        />
      )}

      <CustomChartsSection section={section.route} />
    </div>
  );
}
