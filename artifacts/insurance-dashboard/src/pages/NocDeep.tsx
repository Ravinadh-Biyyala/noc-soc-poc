// Network Operations Center (NOC) deep-dive — the network-ops companion to the
// SOC dashboard. Reads the live monitoring feeds (solarwinds + manageengine
// alarms, device performance metrics, AI incident/anomaly streams, core-node
// telemetry, branch health) via the canonical NOC functions (src/lib/
// loki-noc-deep.ts → /api/loki/noc/*) — same grounding as the BI Companion chat.

import { useState, useMemo, useRef } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Network, RefreshCw, AlertCircle, ExternalLink, Activity, Siren, AlertOctagon,
  Cpu, Timer, Building2, ServerCog, Gauge, Workflow, Radio, ScrollText, HardDrive,
} from "lucide-react";
import { useRegisterObservation } from "@/lib/chat-observer";
import { useNocUi, readVisualValues } from "@/lib/ui-bridge";
import { fetchNocCore, fetchNocPerf, perfWindow } from "@/lib/loki-noc-deep";
import { DASH_TIME_RANGES } from "@/lib/loki-dashboard";
import type { NodePerf } from "@/lib/loki-noc";
import { fmtNum, severityBadge, metricTone } from "@/lib/noc-format";
import LokiChart from "@/components/loki/LokiChart";
import RankList from "@/components/loki/RankList";
import ExplainButton from "@/components/loki/ExplainButton";

// ── building blocks ───────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, suffix, tone = "default", loading, onClick, explain, explainTitle, explainHint }: {
  icon: typeof Network; label: string; value: number; suffix?: string;
  tone?: "default" | "danger" | "warn" | "ok"; loading?: boolean; onClick?: () => void;
  // When `explain` (or an explicit explainTitle) is set, clicking the tile sends
  // its on-screen value to the BI Companion instead of running a custom onClick.
  explain?: boolean; explainTitle?: string; explainHint?: string;
}) {
  const toneCls = tone === "danger" ? "text-rose-400" : tone === "warn" ? "text-amber-400" : tone === "ok" ? "text-emerald-400" : "text-cyan-300";
  const { explainVisual } = useNocUi();
  const ref = useRef<HTMLDivElement>(null);
  const explainable = explain || !!explainTitle;
  const handleClick = explainable
    ? () => explainVisual(explainTitle ?? label, explainHint, readVisualValues(ref.current))
    : onClick;
  return (
    <Card ref={ref} className={`relative overflow-hidden ${handleClick ? "cursor-pointer hover:border-primary/50 transition-colors" : ""}`} onClick={handleClick}>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Icon className={`w-3.5 h-3.5 ${toneCls}`} /> {label}</div>
        {loading ? <Skeleton className="h-7 w-16 mt-1.5" /> : (
          <div className={`text-2xl font-bold mt-0.5 ${toneCls}`}>{fmtNum(value)}{suffix && <span className="text-sm font-medium ml-0.5">{suffix}</span>}</div>
        )}
      </CardContent>
    </Card>
  );
}

function Panel({ title, icon: Icon, children, action, className = "", explainHint }: {
  title: string; icon?: typeof Network; children: React.ReactNode; action?: React.ReactNode; className?: string; explainHint?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm flex items-center gap-1.5">{Icon && <Icon className="w-4 h-4 text-cyan-300" />}{title}</CardTitle>
        <div className="flex items-center gap-2">
          {action}
          <ExplainButton title={title} hint={explainHint} />
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function NodeTable({ nodes }: { nodes: NodePerf[] }) {
  if (!nodes.length) return <p className="text-[11px] text-muted-foreground py-6 text-center">No core-node telemetry in range.</p>;
  const cell = (metric: string, v?: number, suffix = "%") =>
    <span className={`tabular-nums font-semibold ${metricTone(metric, v)}`}>{v == null ? "—" : `${v}${suffix}`}</span>;
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] gap-2 px-3 py-1.5 border-b border-border text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Node</span><span>CPU</span><span>Memory</span><span>Bandwidth</span><span>Latency</span>
      </div>
      <div className="divide-y divide-border/40">
        {nodes.map((n) => (
          <div key={n.node} className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] gap-2 px-3 py-2 text-[11px] items-center">
            <span className="font-mono text-foreground/90 truncate">{n.node}</span>
            {cell("cpu_utilization_percent", n.cpu_pct)}
            {cell("cpu_utilization_percent", n.mem_pct)}
            {cell("cpu_utilization_percent", n.bandwidth_pct)}
            {cell("latency_ms", n.latency_ms, "ms")}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function NocDeep() {
  // Default to 24h: the device-metric feeds are a dense batch within the last
  // ~24h, and the `unwrap` metric queries are far faster (and reliable) at 24h
  // than 7d (where they can time out under load and render empty).
  const [since, setSince] = useState("24h");
  const [, setLocation] = useLocation();

  // Core (fast: count/json aggregations) and performance (slow: device-metric
  // `unwrap` queries) load as SEPARATE queries so the core dashboard renders
  // immediately and the perf panels fill in independently.
  const { data, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: ["noc-core", since],
    queryFn: () => fetchNocCore(since),
    placeholderData: keepPreviousData,
  });
  // Gate perf behind core: the device-metric `unwrap` queries are heavy, so we
  // let the fast core load first (uncontended) before firing them.
  const { data: perf, isLoading: perfLoading, isFetching: perfFetching, refetch: refetchPerf } = useQuery({
    queryKey: ["noc-perf", since],
    queryFn: () => fetchNocPerf(since),
    placeholderData: keepPreviousData,
    enabled: !!data,
  });

  const k = data?.kpis;
  const perfWin = perfWindow(since);

  useRegisterObservation(
    useMemo(() => ({
      label: "Network Operations (NOC)",
      kind: "other" as const,
      summary:
        `User is on the NOC deep-dive dashboard (time range ${since}). Monitoring feeds: SolarWinds + ManageEngine ` +
        `alarms, device performance metrics (CPU/latency), AI incident & anomaly streams, core-node telemetry. ` +
        `${fmtNum(k?.totalAlarms ?? 0)} alarms (${fmtNum(k?.criticalAlarms ?? 0)} critical, ${fmtNum(k?.openAlarms ?? 0)} open), ` +
        `${k?.networkIncidents ?? 0} network incidents, ${k?.earlyWarnings ?? 0} early warnings. Use noc_alarm_analytics / ` +
        `top_alarming_devices / noc_node_performance / metric_trend / incidents / early_warnings to answer.`,
      suggestions: [
        "Which devices are alarming the most?",
        "Break down the alarms by source and severity",
        "How are the core nodes performing?",
        "What's the open vs resolved alarm split?",
      ],
    }), [since, k?.totalAlarms, k?.criticalAlarms, k?.openAlarms, k?.networkIncidents, k?.earlyWarnings]),
  );

  const sourcePie = useMemo(
    () => (data?.analytics.by_source ?? []).map((s) => ({ source: s.key, count: s.count })),
    [data?.analytics.by_source],
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Network className="w-5 h-5 text-cyan-400" /> Network Operations Center
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Deep-dive: alarm analytics, device performance, core-node health, incidents &amp; branches
            {data ? ` · ${fmtNum(data.kpis.totalAlarms)} alarms in range` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => setLocation("/loki-traces")}>
            <Workflow className="w-3.5 h-3.5" /> Traces
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => { refetch(); refetchPerf(); }}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching || perfFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Select value={since} onValueChange={setSince}>
            <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{DASH_TIME_RANGES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {error ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
          <AlertCircle className="w-6 h-6 text-rose-500" /><p className="text-sm">{(error as Error).message}</p>
          <p className="text-xs">Is the Python Loki service running and reachable?</p>
        </CardContent></Card>
      ) : (
        <>
          {/* KPI strip — NOC-specific metrics (device-availability / peak-CPU /
              branches-down live on the main dashboard, so they're not repeated). */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <KpiCard icon={Siren} label="Total alarms" value={k?.totalAlarms ?? 0} loading={isLoading} explain />
            <KpiCard icon={AlertOctagon} label="Critical alarms" value={k?.criticalAlarms ?? 0} tone="danger" loading={isLoading} explain />
            <KpiCard icon={AlertCircle} label="Warning alarms" value={k?.warningAlarms ?? 0} tone="warn" loading={isLoading} explain />
            <KpiCard icon={Siren} label="Open alarms" value={k?.openAlarms ?? 0} tone="warn" loading={isLoading} explain />
            <KpiCard icon={Gauge} label="Resolved alarms" value={k?.resolvedAlarms ?? 0} tone="ok" loading={isLoading} explain />
            <KpiCard icon={Activity} label="Network incidents" value={k?.networkIncidents ?? 0} tone="danger" loading={isLoading} onClick={() => setLocation("/loki-traces")} />
            <KpiCard icon={Radio} label="Early warnings" value={k?.earlyWarnings ?? 0} tone="warn" loading={isLoading} explain />
          </div>

          {/* Alarm analytics: source / severity / status */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Panel title="Alarms by source" icon={ScrollText}>
              {isLoading ? <Skeleton className="h-[200px]" /> : <LokiChart type="pie" xKey="source" yKey="count" data={sourcePie} height={200} />}
            </Panel>
            <Panel title="Alarms by severity" icon={Siren}>
              {isLoading ? <Skeleton className="h-[200px]" /> : (
                <LokiChart type="bar" xKey="severity" yKey="count" height={200}
                  data={(data?.analytics.by_severity ?? []).map((s) => ({ severity: s.severity, count: s.count }))} />
              )}
            </Panel>
            <Panel title="Alarm status" icon={Gauge}>
              {isLoading ? <Skeleton className="h-[200px]" /> : (
                <LokiChart type="pie" xKey="status" yKey="count" height={200}
                  data={(data?.analytics.by_status ?? []).map((s) => ({ status: s.key, count: s.count }))} />
              )}
            </Panel>
          </div>

          {/* Top alarming devices / models / sites */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Panel title="Noisiest devices" icon={ServerCog}>
              {isLoading ? <Skeleton className="h-44" /> : (
                <RankList color="#f43f5e" items={(data?.topAlarmingDevices ?? []).map((d) => ({ value: d.device, count: d.count }))} />
              )}
            </Panel>
            <Panel title="Alarms by hardware model" icon={HardDrive}>
              {isLoading ? <Skeleton className="h-44" /> : (
                <RankList color="#a78bfa" items={(data?.analytics.by_model ?? []).map((m) => ({ value: m.key, count: m.count }))} />
              )}
            </Panel>
            <Panel title="Alarms by site" icon={Building2}>
              {isLoading ? <Skeleton className="h-44" /> : (
                <RankList color="#f59e0b" items={(data?.analytics.by_site ?? []).map((s) => ({ value: s.key, count: s.count }))} empty="No site-tagged alarms." />
              )}
            </Panel>
          </div>

          {/* Performance: trends + top devices (loaded independently — these
              device-metric queries are heavy, so they fill in after the core). */}
          <div className="flex items-center gap-2 pt-1">
            <Cpu className="w-4 h-4 text-cyan-300" />
            <h2 className="text-sm font-semibold text-foreground">Device performance</h2>
            <span className="text-[11px] text-muted-foreground">
              over {perfWin}{perfWin !== since ? " (metrics need ≥24h of samples)" : ""}
              {perfFetching && " · loading…"}
            </span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Fleet CPU trend (avg)" icon={Cpu}>
              {perfLoading ? <Skeleton className="h-[200px]" /> : (
                <LokiChart type="line" xKey="time" yKey="value" data={perf?.cpuTrend.rows ?? []} height={200} colors={["#22d3ee"]} />
              )}
            </Panel>
            <Panel title="Fleet latency trend (avg)" icon={Timer}>
              {perfLoading ? <Skeleton className="h-[200px]" /> : (
                <LokiChart type="line" xKey="time" yKey="value" data={perf?.latencyTrend.rows ?? []} height={200} colors={["#f59e0b"]} />
              )}
            </Panel>
          </div>

          {/* Core-node telemetry */}
          <Panel title="SolarWinds core-node telemetry" icon={ServerCog}>
            {isLoading ? <Skeleton className="h-40" /> : <NodeTable nodes={data?.nodes ?? []} />}
          </Panel>

          {/* Incidents + early warnings */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Panel title="Network incident queue" icon={Activity} className="lg:col-span-2"
              action={<Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={() => setLocation("/loki-traces")}>Traces <ExternalLink className="w-3 h-3" /></Button>}>
              {isLoading ? <Skeleton className="h-44" /> : (
                <div className="space-y-1 max-h-[320px] overflow-y-auto">
                  {(data?.incidents ?? []).length === 0 && <p className="text-[11px] text-muted-foreground py-6 text-center">No network incidents in range.</p>}
                  {(data?.incidents ?? []).map((inc, i) => (
                    <div key={inc.incident_id ?? i} className="flex items-center gap-2 text-[11px] px-1 py-1 border-b border-border/40">
                      <span className={`inline-block rounded border px-1 py-0.5 text-[9px] font-semibold uppercase ${severityBadge(inc.severity)}`}>{inc.severity ?? "—"}</span>
                      <span className="text-foreground/90 truncate flex-1">{inc.incident || inc.summary || inc.incident_id}</span>
                      <span className="font-mono text-[9px] text-muted-foreground shrink-0">{inc.incident_id}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
            <Panel title="Early warnings" icon={Radio}>
              {isLoading ? <Skeleton className="h-44" /> : (
                <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
                  {(data?.earlyWarnings ?? []).length === 0 && <p className="text-[11px] text-muted-foreground py-6 text-center">No early warnings in range.</p>}
                  {(data?.earlyWarnings ?? []).map((w, i) => (
                    <div key={i} className="rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-block rounded border px-1 py-0.5 text-[9px] font-semibold uppercase ${severityBadge(w.risk)}`}>{w.kind ?? "anomaly"}</span>
                        <span className="text-[11px] text-foreground/90 truncate flex-1">{w.asset}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate" title={w.warning}>{w.warning}</p>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
