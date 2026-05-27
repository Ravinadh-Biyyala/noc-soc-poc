import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Bot,
  Send,
  ChevronRight,
  BrainCircuit,
  Loader2,
  Sparkles as SparklesNav,
  PlusCircle,
  CornerDownRight,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { useCopilot } from "@/lib/copilot-context";
import { useTenantConfig } from "@/lib/tenant-config";
import { useGeneratedDashboards } from "@/lib/generated-dashboards";
import { useChatObserver } from "@/lib/chat-observer";
import { Eye, AlertTriangle, Info, AlertOctagon, Check, XCircle } from "lucide-react";
import { NAV } from "@/lib/nav-config";
import { useActiveWorkspace } from "@/lib/active-workspace";
import {
  useListOpenaiConversations,
  useCreateOpenaiConversation,
  useListOpenaiMessages,
  getListOpenaiConversationsQueryKey,
  getListOpenaiMessagesQueryKey
} from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useCustomDashboards, classifyChart } from "@/lib/custom-dashboards";
import {
  ResponsiveContainer,
  BarChart, Bar,
  AreaChart, Area,
  LineChart, Line,
  PieChart, Pie, Cell,
  ScatterChart, Scatter, ZAxis,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ComposedChart,
  FunnelChart, Funnel, LabelList,
  Treemap,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

function generateFollowUps(content: string, observationLabel: string): string[] {
  const lower = content.toLowerCase();
  if (lower.includes('[chart:') || lower.includes('chart') && lower.includes('data'))
    return ["Break this down by another dimension", "What's driving the largest slice?", "Show me the trend over time"];
  if (lower.includes('trend') || lower.includes('month') || lower.includes('year'))
    return ["Compare with the previous period", "What caused the biggest change?", "Forecast the next 3 months"];
  if (lower.includes('top') || lower.includes('highest') || lower.includes('best'))
    return ["Show me the bottom performers too", "What do the top performers have in common?"];
  if (lower.includes('anomal') || lower.includes('outlier') || lower.includes('unusual'))
    return ["When did this anomaly start?", "What other metrics are affected?"];
  if (lower.includes('segment') || lower.includes('region') || lower.includes('categor'))
    return ["Which segment has the most growth potential?", "Show me a comparison chart"];
  return [`What else stands out on ${observationLabel}?`, "How does this compare to benchmarks?"];
}

function pageTitle(location: string): string {
  // Quick lookups so the header reads sensibly on every route.
  if (location === "/") return "Home";
  if (location === "/workspaces") return "Workspaces";
  if (location.startsWith("/workspaces/")) return "Workspace";
  if (location === "/upload") return "Upload Data";
  if (location === "/settings") return "Settings";
  if (location === "/governance") return "Governance";
  if (location === "/dashboards") return "Dashboards";
  if (location.startsWith("/dashboards/")) return "Dashboard";
  return "Dashboard";
}

function SidebarNav({ collapsed }: { collapsed: boolean }) {
  const [location] = useLocation();

  return (
    <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
      {NAV.map((item) => {
        const isActive = item.matchPrefix
          ? location === item.href || location.startsWith(item.matchPrefix + "/")
          : location === item.href;
        return (
          <Link key={item.href} href={item.href}>
            <div
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md text-[13px] transition-all cursor-pointer",
                collapsed ? "justify-center px-2 py-2" : "px-2.5 py-2",
                isActive
                  ? "bg-sidebar-accent text-white font-medium"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-white",
              )}
              data-testid={`nav-${item.label.toLowerCase()}`}
            >
              <item.icon className={cn("w-4 h-4 flex-shrink-0", isActive ? "text-sidebar-primary" : "text-sidebar-foreground/50")} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </div>
          </Link>
        );
      })}
    </nav>
  );
}

const SIDEBAR_COLLAPSED_KEY = "geva-sidebar-collapsed";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { config } = useTenantConfig();
  const { workspace } = useActiveWorkspace();
  const brandName = config?.branding?.name || "Geva";
  const headerTitle = workspace?.name && location.startsWith("/workspaces/") ? workspace.name : pageTitle(location);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  });
  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <aside
        className={cn(
          "flex-shrink-0 border-r border-sidebar-border bg-sidebar flex flex-col transition-[width] duration-200 ease-out",
          sidebarCollapsed ? "w-14" : "w-60",
        )}
      >
        <div
          className={cn(
            "h-14 flex items-center border-b border-sidebar-border",
            sidebarCollapsed ? "justify-center px-2" : "justify-between px-3",
          )}
        >
          {!sidebarCollapsed && (
            <Link href="/">
              <div className="flex items-center gap-2.5 text-white font-bold text-base tracking-tight cursor-pointer">
                <div className="w-7 h-7 rounded-md bg-white/10 flex items-center justify-center">
                  <SparklesNav className="w-4 h-4 text-sidebar-primary" />
                </div>
                {brandName}
              </div>
            </Link>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="w-8 h-8 rounded-md flex items-center justify-center text-sidebar-foreground/60 hover:text-white hover:bg-sidebar-accent/50 transition-colors"
            data-testid="sidebar-toggle"
          >
            {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>
        <SidebarNav collapsed={sidebarCollapsed} />
        {!sidebarCollapsed && (
          <div className="p-3 border-t border-sidebar-border text-[10px] text-sidebar-foreground/40">
            {brandName} {new Date().getFullYear()}
          </div>
        )}
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 flex items-center justify-between px-6 border-b border-border bg-white z-10 sticky top-0">
          <h1 className="text-base font-semibold text-foreground" data-testid="page-title">
            {headerTitle}
          </h1>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-xs text-muted-foreground">Live</span>
            </div>
            <div className="h-5 w-px bg-border"></div>
            <Avatar className="h-7 w-7 border border-border">
              <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">BK</AvatarFallback>
            </Avatar>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-6 bg-background scroll-smooth">
          {children}
        </div>
      </main>

      <aside className="w-[380px] flex-shrink-0 border-l border-border bg-white flex flex-col">
        <ChatPanel />
      </aside>
    </div>
  );
}

const CHART_COLORS = ["#1565C0", "#0288D1", "#0097A7", "#00838F", "#00695C", "#6366f1", "#8b5cf6"];

function InlineChart({ chartData, onAddToDashboard }: {
  chartData: { type: string; title: string; xKey: string; yKey: string; data: any[] };
  onAddToDashboard?: () => void;
}) {
  const { type, title, xKey, yKey, data } = chartData;

  const formatValue = (val: number) => {
    if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `$${(val / 1000).toFixed(0)}K`;
    if (val < 1 && val > 0) return `${(val * 100).toFixed(1)}%`;
    return val.toLocaleString();
  };

  const yKeys = Array.isArray(yKey) ? yKey : [yKey];
  const ttStyle = { backgroundColor: '#fff', borderColor: '#e5e7eb', borderRadius: '8px', fontSize: '11px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' };

  const renderInlineChart = (): React.ReactElement => {
    switch (type) {
      case 'pie':
      case 'donut':
        return (
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={type === 'donut' ? 35 : 0} outerRadius={65} paddingAngle={2} dataKey={yKeys[0]} nameKey={xKey}>
              {data.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [formatValue(v)]} />
          </PieChart>
        );
      case 'bar':
      case 'stacked-bar':
      case 'histogram':
        return (
          <BarChart data={data} margin={{ top: 5, right: 5, left: 10, bottom: 20 }} barCategoryGap={type === 'histogram' ? 2 : '10%'}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey={xKey} fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="#6b7280" />
            <YAxis fontSize={9} tickLine={false} axisLine={false} tickFormatter={formatValue} stroke="#6b7280" />
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [formatValue(v)]} />
            {yKeys.length > 1 && <Legend iconSize={7} wrapperStyle={{ fontSize: "9px" }} />}
            {yKeys.map((k: string, i: number) => (
              <Bar key={k} dataKey={k} stackId={type === 'stacked-bar' ? 's' : undefined} radius={type === 'stacked-bar' ? undefined : [4, 4, 0, 0]} fill={CHART_COLORS[i % CHART_COLORS.length]}>
                {yKeys.length === 1 && data.map((_: any, j: number) => <Cell key={j} fill={CHART_COLORS[j % CHART_COLORS.length]} />)}
              </Bar>
            ))}
          </BarChart>
        );
      case 'horizontal-bar':
        return (
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 15, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
            <XAxis type="number" fontSize={9} tickLine={false} axisLine={false} tickFormatter={formatValue} stroke="#6b7280" />
            <YAxis dataKey={xKey} type="category" fontSize={9} tickLine={false} axisLine={false} width={80} stroke="#6b7280" />
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [formatValue(v)]} />
            <Bar dataKey={yKeys[0]} radius={[0, 4, 4, 0]}>
              {data.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Bar>
          </BarChart>
        );
      case 'line':
        return (
          <LineChart data={data} margin={{ top: 5, right: 5, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey={xKey} fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="#6b7280" />
            <YAxis fontSize={9} tickLine={false} axisLine={false} tickFormatter={formatValue} stroke="#6b7280" />
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [formatValue(v)]} />
            {yKeys.length > 1 && <Legend iconSize={7} wrapperStyle={{ fontSize: "9px" }} />}
            {yKeys.map((k: string, i: number) => (
              <Line key={k} type="monotone" dataKey={k} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={{ fill: CHART_COLORS[i % CHART_COLORS.length], r: 3 }} />
            ))}
          </LineChart>
        );
      case 'scatter':
      case 'bubble':
        return (
          <ScatterChart margin={{ top: 5, right: 5, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey={xKey} type="number" fontSize={9} tickLine={false} axisLine={false} stroke="#6b7280" tickFormatter={formatValue} />
            <YAxis dataKey={yKeys[0]} type="number" fontSize={9} tickLine={false} axisLine={false} stroke="#6b7280" tickFormatter={formatValue} />
            {type === 'bubble' && <ZAxis dataKey={yKeys[1] || yKeys[0]} range={[40, 300]} />}
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [formatValue(v)]} />
            <Scatter data={data} fill={CHART_COLORS[0]}>
              {data.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Scatter>
          </ScatterChart>
        );
      case 'combo':
        return (
          <ComposedChart data={data} margin={{ top: 5, right: 25, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey={xKey} fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="#6b7280" />
            <YAxis yAxisId="left" fontSize={9} tickLine={false} axisLine={false} tickFormatter={formatValue} stroke="#6b7280" />
            <YAxis yAxisId="right" orientation="right" fontSize={9} tickLine={false} axisLine={false} tickFormatter={formatValue} stroke={CHART_COLORS[3]} />
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [formatValue(v)]} />
            <Legend iconSize={7} wrapperStyle={{ fontSize: "9px" }} />
            <Bar yAxisId="left" dataKey={yKeys[0]} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} fillOpacity={0.85} />
            {yKeys[1] && <Line yAxisId="right" type="monotone" dataKey={yKeys[1]} stroke={CHART_COLORS[3]} strokeWidth={2} dot={{ r: 2 }} />}
          </ComposedChart>
        );
      case 'funnel':
        return (
          <FunnelChart>
            <Funnel dataKey={yKeys[0]} data={data.map((d: any, i: number) => ({ ...d, fill: CHART_COLORS[i % CHART_COLORS.length] }))} isAnimationActive>
              <LabelList position="center" fill="#fff" stroke="none" fontSize={9} dataKey={xKey} />
            </Funnel>
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [formatValue(v)]} />
          </FunnelChart>
        );
      case 'radar':
        return (
          <RadarChart cx="50%" cy="50%" outerRadius="65%" data={data}>
            <PolarGrid stroke="#e5e7eb" />
            <PolarAngleAxis dataKey={xKey} fontSize={9} stroke="#6b7280" />
            <PolarRadiusAxis fontSize={8} stroke="#6b7280" />
            <Radar dataKey={yKeys[0]} stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.2} strokeWidth={2} />
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [formatValue(v)]} />
          </RadarChart>
        );
      case 'treemap':
        return (
          <Treemap
            data={data.map((d: any, i: number) => ({ ...d, fill: CHART_COLORS[i % CHART_COLORS.length] }))}
            dataKey={yKeys[0]}
            nameKey={xKey}
            aspectRatio={4 / 3}
            stroke="#fff"
          />
        );
      default:
        return (
          <AreaChart data={data} margin={{ top: 5, right: 5, left: 10, bottom: 20 }}>
            <defs>
              <linearGradient id="chatAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_COLORS[1]} stopOpacity={0.3} />
                <stop offset="95%" stopColor={CHART_COLORS[1]} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey={xKey} fontSize={9} tickLine={false} axisLine={false} angle={-20} textAnchor="end" stroke="#6b7280" />
            <YAxis fontSize={9} tickLine={false} axisLine={false} tickFormatter={formatValue} stroke="#6b7280" />
            <Tooltip contentStyle={ttStyle} formatter={(v: number) => [formatValue(v)]} />
            <Area type="monotone" dataKey={yKeys[0]} stroke={CHART_COLORS[1]} strokeWidth={2} fillOpacity={1} fill="url(#chatAreaGrad)" />
          </AreaChart>
        );
    }
  };

  return (
    <div className="mt-2 mb-1 bg-muted/40 rounded-lg border border-border p-3">
      <div className="mb-2">
        <p className="text-[11px] font-semibold text-foreground">{title}</p>
      </div>
      <div className="h-[180px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {renderInlineChart() as any}
        </ResponsiveContainer>
      </div>
      {(type === 'pie' || type === 'donut') && (
        <div className="grid grid-cols-2 gap-1 mt-2">
          {data.slice(0, 6).map((item: any, i: number) => (
            <div key={i} className="flex items-center gap-1.5 text-[9px]">
              <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
              <span className="text-muted-foreground truncate">{item[xKey]}</span>
            </div>
          ))}
        </div>
      )}
      {onAddToDashboard && (
        <div className="flex items-center justify-between px-1 pt-1.5 pb-0.5 mt-1 border-t border-border/40">
          <span className="text-[9px] text-muted-foreground/60">{data.length} data points</span>
          <button
            onClick={onAddToDashboard}
            className="flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
          >
            <PlusCircle className="w-3 h-3" />
            Add to Dashboard
          </button>
        </div>
      )}
    </div>
  );
}

function InlineTable({ tableData, onAddToDashboard }: {
  tableData: { title: string; columns: string[]; rows: string[][] };
  onAddToDashboard?: () => void;
}) {
  const { title, columns, rows } = tableData;
  return (
    <div className="mt-2 mb-1 bg-muted/40 rounded-lg border border-border p-3">
      <p className="text-[11px] font-semibold text-foreground mb-2">{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr className="border-b border-border">
              {columns.map((col, i) => (
                <th key={i} className="text-left py-1 px-1.5 font-semibold text-muted-foreground whitespace-nowrap">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={cn("border-b border-border/30", ri % 2 === 1 ? "bg-white/60" : "")}>
                {row.map((cell, ci) => (
                  <td key={ci} className="py-1 px-1.5 text-foreground">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onAddToDashboard && (
        <div className="flex items-center justify-between px-1 pt-1.5 pb-0.5 mt-1 border-t border-border/40">
          <span className="text-[9px] text-muted-foreground/60">{rows.length} rows</span>
          <button onClick={onAddToDashboard} className="flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors">
            <PlusCircle className="w-3 h-3" />
            Add to Dashboard
          </button>
        </div>
      )}
    </div>
  );
}

function InlineMetric({ metricData, onAddToDashboard }: {
  metricData: { title: string; value: string; subtitle?: string; trend?: string };
  onAddToDashboard?: () => void;
}) {
  const { title, value, subtitle, trend } = metricData;
  const trendArrow = trend === "up" ? "↑" : trend === "down" ? "↓" : null;
  const trendColor = trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-500" : "";
  return (
    <div className="mt-2 mb-1 bg-primary/5 rounded-lg border border-primary/20 p-3">
      <p className="text-[10px] text-muted-foreground mb-1">{title}</p>
      <div className="flex items-end gap-2">
        <span className="text-xl font-bold text-foreground">{value}</span>
        {trendArrow && <span className={cn("text-sm font-semibold mb-0.5", trendColor)}>{trendArrow}</span>}
      </div>
      {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>}
      {onAddToDashboard && (
        <div className="flex justify-end pt-1.5 mt-1 border-t border-primary/10">
          <button onClick={onAddToDashboard} className="flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors">
            <PlusCircle className="w-3 h-3" />
            Add to Dashboard
          </button>
        </div>
      )}
    </div>
  );
}

function parseVisuals(content: string): { text: string; charts: any[]; tables: any[]; metrics: any[] } {
  const charts: any[] = [];
  const tables: any[] = [];
  const metrics: any[] = [];
  let text = content;

  function extractTokens(marker: string, target: any[]) {
    let startIdx = text.indexOf(marker);
    while (startIdx !== -1) {
      const jsonStart = startIdx + marker.length;
      let depth = 0;
      let endIdx = jsonStart;
      for (let i = jsonStart; i < text.length; i++) {
        if (text[i] === '{') depth++;
        if (text[i] === '}') depth--;
        if (depth === 0) { endIdx = i + 1; break; }
      }
      const closeBracket = text.indexOf(']', endIdx);
      const fullMatch = text.substring(startIdx, closeBracket !== -1 ? closeBracket + 1 : endIdx);
      const jsonStr = text.substring(jsonStart, endIdx);
      try { target.push(JSON.parse(jsonStr)); } catch {}
      text = text.replace(fullMatch, '');
      startIdx = text.indexOf(marker);
    }
  }

  extractTokens('[CHART:', charts);
  extractTokens('[TABLE:', tables);
  extractTokens('[METRIC:', metrics);

  return { text: text.trim(), charts, tables, metrics };
}

// kept for backward compat with any callers that still use parseCharts
function parseCharts(content: string): { text: string; charts: any[] } {
  const { text, charts } = parseVisuals(content);
  return { text, charts };
}

// ─── Hidden context marker ────────────────────────────────────────────────────
// Some callers (e.g. clicking a chart to ask Copilot to explain it) need to
// send the raw data + response instructions to the model without polluting
// the user-visible message bubble. They prefix the hidden portion with
// "[[CTX]]" and we strip everything from that marker onwards for display.
function stripHiddenContext(content: string): string {
  const idx = content.indexOf("[[CTX]]");
  return idx === -1 ? content : content.slice(0, idx).trim();
}

// ─── Inline bold + markdown renderer for assistant responses ──────────────────
function InlineBold({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**")
          ? <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

function normalizeMarkdown(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n");
  // If the model returned inline bullets like "Foo. - Bar - Baz", break them
  // onto new lines so the parser below recognises them.
  if (!/\n\s*[-*•]\s/.test(t)) {
    const c = t.replace(/([.!?:,;])\s{1,4}[-–—]\s{1,4}/g, "$1\n- ");
    if (c !== t) t = c;
  }
  return t;
}

function MarkdownText({ content }: { content: string }) {
  type Seg =
    | { k: "h1" | "h2" | "h3"; text: string }
    | { k: "bullets"; items: string[] }
    | { k: "numbered"; items: string[] }
    | { k: "para"; text: string };

  const segs: Seg[] = [];
  let bullets: string[] = [];
  let numbered: string[] = [];

  const flushBullets = () => { if (bullets.length) { segs.push({ k: "bullets", items: [...bullets] }); bullets = []; } };
  const flushNumbered = () => { if (numbered.length) { segs.push({ k: "numbered", items: [...numbered] }); numbered = []; } };
  const flush = () => { flushBullets(); flushNumbered(); };

  for (const raw of content.split("\n")) {
    const t = raw.trim();
    if (!t) { flush(); continue; }

    const hm = t.match(/^(#{1,3})\s+(.+)$/);
    if (hm) {
      flush();
      const level = hm[1].length;
      segs.push({ k: level === 1 ? "h1" : level === 2 ? "h2" : "h3", text: hm[2] });
      continue;
    }

    const bm = t.match(/^[-*•]\s+(.+)$/);
    if (bm) { flushNumbered(); bullets.push(bm[1]); continue; }

    const nm = t.match(/^\d+\.\s+(.+)$/);
    if (nm) { flushBullets(); numbered.push(nm[1]); continue; }

    flush();
    segs.push({ k: "para", text: t });
  }
  flush();

  return (
    <div className="space-y-2">
      {segs.map((s, i) => {
        if (s.k === "h1") return (
          <div key={i} className="font-bold text-[13px] text-foreground mt-1.5 mb-0.5">
            <InlineBold text={s.text} />
          </div>
        );
        if (s.k === "h2") return (
          <div key={i} className="font-semibold text-[10px] text-primary/80 mt-1.5 mb-0.5 uppercase tracking-wide">
            <InlineBold text={s.text} />
          </div>
        );
        if (s.k === "h3") return (
          <div key={i} className="font-semibold text-[12px] text-foreground mt-1 mb-0.5">
            <InlineBold text={s.text} />
          </div>
        );
        if (s.k === "bullets") return (
          <ul key={i} className="space-y-1 my-1 pl-1">
            {s.items.map((it, j) => (
              <li key={j} className="flex gap-2 items-start">
                <span className="text-primary font-black mt-[1px] flex-shrink-0 text-[14px] leading-none">•</span>
                <span className="flex-1 leading-relaxed"><InlineBold text={it} /></span>
              </li>
            ))}
          </ul>
        );
        if (s.k === "numbered") return (
          <ol key={i} className="space-y-1 my-1">
            {s.items.map((it, j) => (
              <li key={j} className="flex gap-2 items-start">
                <span className="text-primary font-semibold flex-shrink-0 min-w-[1.25rem] text-[11px]">{j + 1}.</span>
                <span className="flex-1 leading-relaxed"><InlineBold text={it} /></span>
              </li>
            ))}
          </ol>
        );
        return (
          <p key={i} className="leading-relaxed">
            <InlineBold text={s.text} />
          </p>
        );
      })}
    </div>
  );
}

function ChatPanel() {
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [streamingMessage, setStreamingMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [pendingUserMessage, setPendingUserMessage] = useState("");
  const [highlightInput, setHighlightInput] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { registerHandler } = useCopilot();
  const pendingQuestionRef = useRef<string | null>(null);
  const { config } = useTenantConfig();
  const { pack } = useActiveWorkspace();
  const { observation, agentSuggestions, dismissAgentSuggestion } = useChatObserver();
  const { addChart } = useCustomDashboards();
  const { toast } = useToast();

  const handleAddChartToDashboard = (chartData: { type: string; title: string; xKey: string; yKey: string; data: any[] }) => {
    const onGeneratedPage =
      location.startsWith("/generated/") ||
      location.startsWith("/custom/") ||
      location.startsWith("/my-dashboards/");
    const section = onGeneratedPage ? location : classifyChart(chartData).section;
    const sectionLabel = onGeneratedPage ? observation.label : classifyChart(chartData).sectionLabel;
    addChart({ ...chartData, section, sectionLabel });
    toast({ title: `Added to ${sectionLabel}`, description: `"${chartData.title}" pinned to your dashboard.` });
  };
  // Conversations into which we've already injected the page-context block
  // (so we don't re-pay the prompt cost on every turn). Cleared when the
  // observation label changes — next message in the same conversation will
  // re-seed against the new view.
  const seededConvIds = useRef<Set<number>>(new Set());
  const prevObservationLabel = useRef<string | null>(null);

  // Listen for the global "copilot:focus" event (dispatched, for example,
  // by the Home "Ask Gen-BI" quick action) and visibly bring the chat
  // input into focus with a brief highlight ring so the user has clear
  // feedback that the Copilot is ready.
  useEffect(() => {
    const onFocus = (ev: Event) => {
      const el = inputRef.current;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        el.focus({ preventScroll: false });
      }
      // If the dispatcher passed a seed prompt (e.g. the chat-first hero on
      // Home), prefill the input so the user can review/edit before sending.
      const detail = (ev as CustomEvent).detail as { seed?: string } | undefined;
      const seed = detail?.seed?.trim();
      if (seed) setInput(seed);
      setHighlightInput(true);
      window.setTimeout(() => setHighlightInput(false), 1400);
    };
    window.addEventListener("copilot:focus", onFocus);
    return () => window.removeEventListener("copilot:focus", onFocus);
  }, []);

  // When the user is inside a workspace, prefer that workspace's pack copy.
  // Falls back to the global tenant config (legacy insurance content) and
  // finally to safe generic prompts.
  const copilotName =
    pack?.copilotName || config?.branding?.copilotName || "BI Companion";
  // Page-aware suggestions take precedence over pack defaults — when a
  // page (e.g. a generated dashboard) registers its own chips via
  // useRegisterObservation, the Copilot reflects what the user is actually
  // looking at instead of generic "Show top 10 records" prompts.
  const suggestedPrompts =
    observation.suggestions?.slice(0, 4) ||
    pack?.suggestedPrompts.slice(0, 3) ||
    config?.suggestedPrompts?.slice(0, 3) || [
      "Summarize what's on this page",
      "What should I do next?",
      "Show me the most interesting metric",
    ];

  const { data: conversations } = useListOpenaiConversations();
  const createConv = useCreateOpenaiConversation();
  
  const { data: messages = [] } = useListOpenaiMessages(activeConvId || 0, { 
    query: { enabled: !!activeConvId, queryKey: getListOpenaiMessagesQueryKey(activeConvId || 0) } 
  });

  useEffect(() => {
    if (conversations?.length && !activeConvId) {
      setActiveConvId(conversations[0].id);
    } else if (conversations?.length === 0 && !activeConvId) {
      createConv.mutate({ data: { title: "New Conversation" } }, {
        onSuccess: (conv) => {
          setActiveConvId(conv.id);
          queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
        }
      });
    }
  }, [conversations, activeConvId, createConv, queryClient]);

  useEffect(() => {
    registerHandler((question: string) => {
      if (activeConvId && !isTyping) {
        setInput(question);
        pendingQuestionRef.current = question;
      }
    });
  }, [registerHandler, activeConvId, isTyping]);

  useEffect(() => {
    if (pendingQuestionRef.current && input === pendingQuestionRef.current && activeConvId && !isTyping) {
      pendingQuestionRef.current = null;
      handleSendMessage(input);
    }
  }, [input, activeConvId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingMessage, isTyping]);

  const handleNewChat = () => {
    createConv.mutate({ data: { title: "New Conversation" } }, {
      onSuccess: (conv) => {
        setActiveConvId(conv.id);
        queryClient.invalidateQueries({ queryKey: getListOpenaiConversationsQueryKey() });
      }
    });
  };

  // Auto-open a new conversation when the user navigates to a different dashboard
  // so follow-up questions stay scoped to the current view.
  const latestNavState = useRef({ activeConvId, messagesLen: messages.length, handleNewChat });
  useEffect(() => { latestNavState.current = { activeConvId, messagesLen: messages.length, handleNewChat }; });
  useEffect(() => {
    if (prevObservationLabel.current === null) {
      prevObservationLabel.current = observation.label;
      return;
    }
    if (observation.label !== prevObservationLabel.current) {
      prevObservationLabel.current = observation.label;
      const { activeConvId: convId, messagesLen, handleNewChat: startNewChat } = latestNavState.current;
      if (convId != null) seededConvIds.current.delete(convId);
      if (messagesLen > 0) startNewChat();
    }
  }, [observation.label]);

  const handleSendMessage = async (messageOverride?: string) => {
    const msg = messageOverride || input;
    if (!msg.trim() || !activeConvId) return;
    
    const userMsg = msg.trim();
    setInput("");
    setIsTyping(true);
    setStreamingMessage("");
    setPendingUserMessage(userMsg);

    // Inject the current observation as ground truth on the FIRST send of
    // each conversation (or after the user navigates to a different view).
    // The model carries it forward through the thread so we don't pay the
    // token cost again until the observation actually changes.
    const needsContext = observation.summary && !seededConvIds.current.has(activeConvId);
    const payload = needsContext
      ? `You are the user's right-rail data Copilot. They are currently looking at: **${observation.label}** (${observation.kind}).\n\n[CONTEXT — what's on screen]\n${observation.summary}\n\nUse this context if the question is directly answered here. If the user asks about data not shown (rankings, top N, totals, trends, comparisons), call execute_dataset_query with the relevant dataset to retrieve real results — do NOT say the dashboard doesn't show it.\n\n[USER]\n${userMsg}`
      : userMsg;
    seededConvIds.current.add(activeConvId);

    try {
      const base = import.meta.env.BASE_URL || '/';
      const response = await fetch(`${base}api/openai/conversations/${activeConvId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: payload }),
      });

      if (!response.ok) throw new Error("Failed to send message");
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      setIsTyping(false);
      
      let done = false;
      
      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.done) continue;
                if (parsed.error) {
                  setStreamingMessage(prev => prev || `_${parsed.error}_`);
                  continue;
                }
                if (parsed.status === "querying_database") {
                  setIsTyping(true);
                } else if (parsed.content) {
                  setIsTyping(false);
                  setStreamingMessage(prev => prev + parsed.content);
                }
              } catch (e) {}
            }
          }
        }
      }
      
      await queryClient.invalidateQueries({ queryKey: getListOpenaiMessagesQueryKey(activeConvId) });
      setPendingUserMessage("");
      setStreamingMessage("");
      
    } catch (e) {
      console.error(e);
      setIsTyping(false);
      setPendingUserMessage("");
    }
  };

  const handleAddTableToDashboard = (tableData: { title: string; columns: string[]; rows: string[][] }) => {
    const onGeneratedPage =
      location.startsWith("/generated/") ||
      location.startsWith("/custom/") ||
      location.startsWith("/my-dashboards/");
    const section = onGeneratedPage ? location : "/dashboards";
    const sectionLabel = onGeneratedPage ? observation.label : "Dashboard";
    addChart({ type: "table", title: tableData.title, xKey: "label", yKey: "value", data: tableData.rows.map(r => Object.fromEntries(tableData.columns.map((c, i) => [c, r[i]]))), section, sectionLabel } as any);
    toast({ title: `Added to ${sectionLabel}`, description: `"${tableData.title}" table pinned to your dashboard.` });
  };

  const handleAddMetricToDashboard = (metricData: { title: string; value: string; subtitle?: string }) => {
    const onGeneratedPage =
      location.startsWith("/generated/") ||
      location.startsWith("/custom/") ||
      location.startsWith("/my-dashboards/");
    const section = onGeneratedPage ? location : "/dashboards";
    const sectionLabel = onGeneratedPage ? observation.label : "Dashboard";
    addChart({ type: "metric", title: metricData.title, xKey: "label", yKey: "value", data: [{ label: metricData.title, value: metricData.value }], section, sectionLabel } as any);
    toast({ title: `Added to ${sectionLabel}`, description: `"${metricData.title}" metric pinned to your dashboard.` });
  };

  const renderContent = (content: string) => {
    const { text, charts, tables, metrics } = parseVisuals(content);
    const navMatch = text.match(/\[NAVIGATE:(.*?)\]/);
    const cleaned = text
      .replace(/\[NAVIGATE:.*?\]/g, "")
      .replace(/\[CREATE_DASHBOARD:.*?\]/g, "")
      .trim();
    const normalized = normalizeMarkdown(cleaned);

    return (
      <div className="space-y-2">
        <MarkdownText content={normalized} />
        {metrics.map((m, i) => (
          <InlineMetric key={i} metricData={m} onAddToDashboard={() => handleAddMetricToDashboard(m)} />
        ))}
        {tables.map((t, i) => (
          <InlineTable key={i} tableData={t} onAddToDashboard={() => handleAddTableToDashboard(t)} />
        ))}
        {charts.map((chart, i) => (
          <InlineChart key={i} chartData={chart} onAddToDashboard={() => handleAddChartToDashboard(chart)} />
        ))}
        {navMatch && (
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-1 bg-primary/5 hover:bg-primary/10 border-primary/20 text-primary hover:text-primary transition-all text-xs"
            onClick={() => setLocation(navMatch[1])}
          >
            View Dashboard <ChevronRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        )}
      </div>
    );
  };

  const renderStreamingContent = (content: string) => {
    const { text, charts, tables, metrics } = parseVisuals(content);
    const cleaned = text
      .replace(/\[NAVIGATE:.*?\]/g, "")
      .replace(/\[CREATE_DASHBOARD:.*?\]/g, "")
      .trim();
    const normalized = normalizeMarkdown(cleaned);

    return (
      <div className="space-y-2">
        <MarkdownText content={normalized} />
        {metrics.map((m, i) => <InlineMetric key={i} metricData={m} />)}
        {tables.map((t, i) => <InlineTable key={i} tableData={t} />)}
        {charts.map((chart, i) => <InlineChart key={i} chartData={chart} />)}
      </div>
    );
  };

  return (
    <>
      <div className="h-14 flex items-center justify-between px-4 border-b border-border">
        <div className="flex items-center gap-2 font-semibold text-foreground text-sm">
          <BrainCircuit className="w-4 h-4 text-primary" />
          {copilotName}
          <span className="text-[9px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">BI</span>
        </div>
        <Button variant="ghost" size="icon" onClick={handleNewChat} className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors">
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      {/* Live "what I'm looking at" pill — proves the Copilot is page-aware
          on every screen, not just a generic global chat. */}
      <div className="px-3 py-1.5 border-b border-border bg-primary/5 flex items-center gap-1.5 text-[11px]" data-testid="copilot-observation-pill">
        <Eye className="w-3 h-3 text-primary flex-shrink-0" />
        <span className="text-muted-foreground">Observing</span>
        <span className="font-medium text-foreground truncate flex-1 min-w-0">{observation.label}</span>
      </div>

      {/* Proactive agent suggestions — replaces the dead "Cleaning" /
          "Joins" nav pages. When the data-quality engine flags something
          on upload, it lands here as an actionable card. */}
      {agentSuggestions.length > 0 && (
        <div className="px-2 py-2 border-b border-border bg-amber-50/40 space-y-1.5" data-testid="agent-suggestions-tray">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
            Agent suggestions ({agentSuggestions.length})
          </p>
          {agentSuggestions.map((s) => {
            const SevIcon = s.severity === "critical" ? AlertOctagon : s.severity === "warn" ? AlertTriangle : Info;
            const tone =
              s.severity === "critical"
                ? "border-red-200 bg-red-50"
                : s.severity === "warn"
                ? "border-amber-200 bg-amber-50"
                : "border-blue-200 bg-blue-50";
            const iconTone =
              s.severity === "critical" ? "text-red-600" : s.severity === "warn" ? "text-amber-600" : "text-blue-600";
            return (
              <div
                key={s.id}
                className={cn("rounded-md border p-2 text-[11px] space-y-1.5", tone)}
                data-testid={`agent-suggestion-${s.id}`}
              >
                <div className="flex items-start gap-1.5">
                  <SevIcon className={cn("w-3 h-3 mt-0.5 flex-shrink-0", iconTone)} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground leading-tight">{s.title}</p>
                    <p className="text-muted-foreground mt-0.5 leading-snug">{s.rationale}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 pl-4">
                  {s.onApply && (
                    <Button
                      size="sm"
                      variant="default"
                      className="h-6 px-2 text-[10px] gap-1"
                      onClick={() => {
                        s.onApply?.();
                        dismissAgentSuggestion(s.id);
                      }}
                      data-testid={`agent-suggestion-apply-${s.id}`}
                    >
                      <Check className="w-2.5 h-2.5" />
                      {s.applyLabel || "Apply"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px] gap-1 text-muted-foreground"
                    onClick={() => dismissAgentSuggestion(s.id)}
                    data-testid={`agent-suggestion-skip-${s.id}`}
                  >
                    <XCircle className="w-2.5 h-2.5" />
                    Skip
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}


      <div className="flex-1 overflow-y-auto p-4 space-y-5 bg-muted/30" ref={scrollRef}>
        {messages.length === 0 && !isTyping && !streamingMessage && (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground space-y-2 px-4">
            <p className="text-xs text-muted-foreground leading-relaxed max-w-[240px]">
              {observation.summary
                ? "I can see what's on screen — ask me anything about it, or pick a starter:"
                : "Ask any data question and get instant visualizations."}
            </p>
            <div className="grid grid-cols-1 gap-1.5 w-full max-w-[260px] mt-1">
              {suggestedPrompts.map((q) => (
                <button
                  key={q}
                  className="text-left text-[11px] px-3 py-2 rounded-md border border-border bg-white hover:bg-primary/5 hover:border-primary/30 text-muted-foreground hover:text-foreground transition-all"
                  onClick={() => { setInput(q); }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        
        {messages.map((msg, idx) => (
          <div key={msg.id} className={cn("flex flex-col max-w-[92%]", msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start")}>
            <div className="flex items-center gap-1.5 mb-1 px-0.5">
              {msg.role === 'user' ? (
                <span className="text-[10px] font-medium text-muted-foreground">You</span>
              ) : (
                <>
                  <Bot className="w-3 h-3 text-primary" />
                  <span className="text-[10px] font-medium text-primary">Copilot</span>
                </>
              )}
            </div>
            <div
              className={cn(
                "rounded-xl px-3.5 py-2.5 text-[12px] leading-relaxed",
                msg.role === 'user'
                  ? "bg-primary text-white rounded-tr-sm"
                  : "bg-white border border-border text-foreground rounded-tl-sm shadow-sm",
              )}
            >
              {msg.role === 'user' ? (
                <p className="whitespace-pre-wrap">{stripHiddenContext(msg.content)}</p>
              ) : renderContent(msg.content)}
            </div>
            {/* Follow-up chips — shown only after the last assistant message */}
            {msg.role === 'assistant' && idx === messages.length - 1 && !isTyping && !streamingMessage && (
              <div className="mt-1.5 space-y-1 pl-0.5">
                {generateFollowUps(msg.content, observation.label).map((q) => (
                  <button
                    key={q}
                    onClick={() => handleSendMessage(q)}
                    disabled={isTyping}
                    className="flex items-center gap-1.5 w-full text-left text-[10px] px-2.5 py-1.5 rounded-md border border-border/60 bg-white hover:bg-primary/5 hover:border-primary/30 text-muted-foreground hover:text-foreground transition-all"
                  >
                    <CornerDownRight className="w-2.5 h-2.5 text-primary/60 flex-shrink-0" />
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        
        {pendingUserMessage && (
          <div className="flex flex-col max-w-[92%] ml-auto items-end">
            <div className="rounded-xl px-3.5 py-2.5 text-[12px] leading-relaxed bg-primary text-primary-foreground rounded-tr-sm shadow-sm">
              <p className="whitespace-pre-wrap">{stripHiddenContext(pendingUserMessage)}</p>
            </div>
          </div>
        )}

        {(streamingMessage || isTyping) && (
          <div className="flex flex-col max-w-[92%] mr-auto items-start">
            <div className="flex items-center gap-1.5 mb-1 px-0.5">
              <Bot className="w-3 h-3 text-primary" />
              <span className="text-[10px] font-medium text-primary">Copilot</span>
            </div>
            <div className="rounded-xl px-3.5 py-2.5 text-[12px] leading-relaxed bg-white border border-border text-foreground rounded-tl-sm shadow-sm">
              {isTyping ? (
                <div className="flex items-center gap-2 py-0.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                  <span className="text-muted-foreground text-xs animate-pulse">Generating insights...</span>
                </div>
              ) : (
                renderStreamingContent(streamingMessage)
              )}
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-border bg-white">
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
          className="relative flex items-center"
        >
          <Input
            ref={inputRef}
            data-testid="copilot-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything about your data..."
            className={cn(
              "pr-10 bg-muted/50 border-border focus-visible:ring-primary h-9 rounded-lg text-sm placeholder:text-muted-foreground/60 transition-shadow",
              highlightInput && "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-md",
            )}
            disabled={isTyping}
          />
          <Button 
            type="submit" 
            size="icon" 
            variant="ghost" 
            className="absolute right-1 h-7 w-7 text-primary hover:text-primary hover:bg-primary/10 transition-all"
            disabled={!input.trim() || isTyping}
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </form>
      </div>
    </>
  );
}
