// Unified NOC/SOC overview dashboard. High-level health metrics across the whole
// monitored fleet (device availability, alarms, AI incidents, performance,
// security) where every panel is clickable to drill into a deep diagnosis via the
// slide-over DiagnosisDrawer. All data comes from the canonical backend NOC
// functions (src/lib/loki-dashboard.ts → /api/loki/noc/*) — the same functions the
// chat agent calls, so the numbers always agree.

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity, ShieldAlert, RefreshCw, AlertCircle, Radio, Cpu, Network, Gauge, ServerCog,
  Boxes, Siren, AlertOctagon, Timer, ExternalLink, ChevronRight, Crosshair, Building2, Globe,
} from "lucide-react";
import { useRegisterObservation } from "@/lib/chat-observer";
import { useNocUi } from "@/lib/ui-bridge";
import { fetchNocDashboard, DASH_TIME_RANGES, readDashboardCache, writeDashboardCache } from "@/lib/loki-dashboard";
import { type DeviceMetricRank } from "@/lib/loki-noc";
import { fmtNum, fmtAgo, severityBadge, metricTone, severityColor } from "@/lib/noc-format";
import TimeSeriesChart from "@/components/loki/TimeSeriesChart";
import TopologyMap, { type TopoNode } from "@/components/loki/TopologyMap";
import GeoThreatMap from "@/components/loki/GeoThreatMap";
import LokiChart from "@/components/loki/LokiChart";
import AlarmTable from "@/components/loki/AlarmTable";
import { type DrawerTarget } from "@/components/loki/DiagnosisDrawer";

const LIVE_OPTIONS = [
  { value: "0", label: "Live: Off" },
  { value: "10000", label: "Live: 10s" },
  { value: "30000", label: "Live: 30s" },
  { value: "60000", label: "Live: 60s" },
];

// Map a clicked visual (drawer target) to a natural-language ask for the chat,
// so the BI Companion fetches the matching NOC function and answers inline.
function promptForTarget(t: DrawerTarget): string {
  switch (t.kind) {
    case "device":
      return `Check the health of device ${t.id} and summarise its status, open alarms and any related incidents.`;
    case "incident":
      return `Diagnose incident ${t.id}: root cause, evidence and recommended actions.`;
    case "alarms": {
      const scope = [t.severity, t.category].filter(Boolean).join(" ");
      return `Show the ${scope || "recent"} alarms and summarise what's happening.`;
    }
    case "incidents":
      return `Show the ${t.severity ? `${t.severity} ` : ""}incidents and summarise the key ones.`;
  }
}

// ── small building blocks ───────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, suffix, tone = "default", loading, onClick }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: number; suffix?: string;
  tone?: "default" | "danger" | "warn" | "ok"; loading?: boolean; onClick?: () => void;
}) {
  const toneCls = tone === "danger" ? "text-rose-400" : tone === "warn" ? "text-amber-400" : tone === "ok" ? "text-emerald-400" : "text-cyan-300";
  return (
    <Card className={`relative overflow-hidden ${onClick ? "cursor-pointer hover:border-primary/50 transition-colors" : ""}`} onClick={onClick}>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Icon className={`w-3.5 h-3.5 ${toneCls}`} /> {label}</div>
        {loading ? <Skeleton className="h-7 w-16 mt-1.5" /> : (
          <div className={`text-2xl font-bold mt-0.5 ${toneCls}`}>{fmtNum(value)}{suffix && <span className="text-sm font-medium ml-0.5">{suffix}</span>}</div>
        )}
      </CardContent>
    </Card>
  );
}

// Device Availability KPI — shows online/total + availability %, click → Assets.
function AvailabilityCard({ online, total, pct, loading, onClick }: {
  online: number; total: number; pct: number; loading?: boolean; onClick: () => void;
}) {
  const tone = pct >= 99 ? "text-emerald-400" : pct >= 90 ? "text-amber-400" : "text-rose-400";
  return (
    <Card className="relative overflow-hidden cursor-pointer hover:border-primary/50 transition-colors" onClick={onClick} title="View all assets">
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Boxes className={`w-3.5 h-3.5 ${tone}`} /> Device Availability</div>
        {loading ? <Skeleton className="h-7 w-20 mt-1.5" /> : (
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className={`text-xl font-bold ${tone}`}>{fmtNum(online)}/{fmtNum(total)}</span>
            <span className={`text-xs font-semibold ${tone}`}>{pct}%</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Panel({ title, icon: Icon, children, action, span = "" }: {
  title: string; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode; action?: React.ReactNode; span?: string;
}) {
  return (
    <Card className={span}>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm flex items-center gap-1.5">{Icon && <Icon className="w-4 h-4 text-cyan-300" />}{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ViewAll({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-0.5 text-[11px] text-primary hover:underline">
      View all <ChevronRight className="w-3 h-3" />
    </button>
  );
}

// Clickable performance bar list (top CPU / link util / latency).
function MetricBarList({ rows, metric, onPick }: { rows: DeviceMetricRank[]; metric: string; onPick: (device: string) => void }) {
  if (!rows || rows.length === 0) return <p className="text-xs text-muted-foreground py-6 text-center">No metric data in this range.</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const unit = metric === "latency_ms" ? "" : "%";
  return (
    <div className="space-y-1.5">
      {rows.slice(0, 8).map((r) => (
        <button key={r.device_id} onClick={() => onPick(r.device_id)}
          className="w-full group flex items-center gap-2 text-left hover:bg-accent/40 rounded px-1 py-0.5 transition-colors">
          <div className="relative flex-1 h-6 rounded bg-muted/40 overflow-hidden">
            <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${(r.value / max) * 100}%`, backgroundColor: severityColor(r.value >= 85 ? "critical" : r.value >= 65 ? "warning" : "info"), opacity: 0.25 }} />
            <span className="absolute inset-0 flex items-center px-2 text-[11px] font-mono truncate text-foreground">{r.device_id}</span>
          </div>
          <span className={`text-[11px] font-semibold tabular-nums w-14 text-right ${metricTone(metric, r.value)}`}>{r.value}{unit}</span>
        </button>
      ))}
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function LokiDashboard() {
  const [, setLocation] = useLocation();
  const [since, setSince] = useState("24h");
  const [live, setLive] = useState("0");
  const { openDiagnosis, askCompanion } = useNocUi();

  // Clicking a visual is a two-way AG-UI gesture: it opens the deep-diagnosis
  // drawer (chat→UI direction is the same drawer) AND asks the BI Companion to
  // fetch + explain whatever was clicked (UI→chat), so the chat reacts in real time.
  const open = useCallback((t: DrawerTarget) => {
    openDiagnosis(t, since);
    askCompanion(promptForTarget(t));
  }, [openDiagnosis, askCompanion, since]);

  const { data, isLoading, error, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["noc-dashboard", since],
    queryFn: () => fetchNocDashboard(since),
    refetchInterval: live === "0" ? false : Number(live),
    placeholderData: keepPreviousData,
    // Seed from the persisted snapshot so the page shows the previous dashboard
    // immediately (no skeletons) while it recomputes in the background. The stale
    // timestamp makes react-query refetch on mount and swap the fresh data in.
    initialData: () => readDashboardCache(since)?.data,
    initialDataUpdatedAt: () => readDashboardCache(since)?.ts,
  });

  // Mirror each settled result back to localStorage for the next cold load.
  useEffect(() => {
    if (data) writeDashboardCache(since, data);
  }, [dataUpdatedAt, since, data]);

  useRegisterObservation(
    useMemo(() => ({
      label: "NOC Dashboard",
      kind: "other" as const,
      summary:
        `User is on the unified NOC/SOC overview dashboard (time range ${since}). It monitors ~${data?.kpis.totalDevices ?? "100+"} devices ` +
        `with ${data?.kpis.criticalAlarms ?? 0} critical alarms and ${data?.kpis.activeIncidents ?? 0} active incidents. ` +
        "Use the named NOC functions (getTopAlarms, getIncidents, diagnoseIncident, getDeviceHealth, getTopDevicesByMetric, etc.) to answer — do NOT hand-write LogQL unless none fit. Render structured cards/charts.",
      suggestions: [
        "Check the health of the critical device",
        "Diagnose the latest critical incident",
        "Show the top CPU-utilization devices and chart it",
        "Summarise security events and SSH brute-force attempts",
      ],
    }), [since, data?.kpis.totalDevices, data?.kpis.criticalAlarms, data?.kpis.activeIncidents]),
  );

  // Topology nodes = device categories (click → alarms scoped to category).
  const topoNodes: TopoNode[] = useMemo(
    () => (data?.inventory.categories ?? []).map((c) => ({ label: `${c.category} (${c.count})`, value: c.category, count: c.count, attack: c.category === "security" })),
    [data?.inventory.categories],
  );

  const invChart = useMemo(() => (data?.inventory.categories ?? []).map((c) => ({ category: c.category, count: c.count })), [data?.inventory.categories]);
  const incidentDonut = useMemo(() => (data?.incidents.by_severity ?? []).map((s) => ({ severity: s.severity, count: s.count })), [data?.incidents.by_severity]);

  return (
    <div className="space-y-3">
      {/* Control bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ServerCog className="w-5 h-5 text-cyan-400" />
          <h1 className="text-xl font-bold text-foreground">NOC / SOC Operations</h1>
          <span className="flex items-center gap-1 text-[11px] text-emerald-400">
            <Radio className={`w-3 h-3 ${live !== "0" ? "animate-pulse" : ""}`} /> {live !== "0" ? "live" : "static"}
          </span>
          {isFetching && <RefreshCw className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
          {dataUpdatedAt > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {isFetching ? "Refreshing…" : `Updated ${fmtAgo(dataUpdatedAt)}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => setLocation("/loki-logs")}>
            <ExternalLink className="w-3.5 h-3.5" /> Explorer
          </Button>
          <Select value={live} onValueChange={setLive}>
            <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{LIVE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
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
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <AvailabilityCard online={data?.kpis.deviceOnline ?? 0} total={data?.kpis.totalDevices ?? 0} pct={data?.kpis.availabilityPct ?? 0} loading={isLoading} onClick={() => setLocation("/assets")} />
            <StatCard icon={Siren} label="Total alarms" value={data?.kpis.totalAlarms ?? 0} loading={isLoading} onClick={() => open({ kind: "alarms", severity: undefined, title: "All alarms" })} />
            <StatCard icon={AlertOctagon} label="Critical alarms" value={data?.kpis.criticalAlarms ?? 0} tone="danger" loading={isLoading} onClick={() => open({ kind: "alarms", severity: "critical", title: "Critical alarms" })} />
            <StatCard icon={AlertCircle} label="Active incidents" value={data?.kpis.activeIncidents ?? 0} tone="danger" loading={isLoading} onClick={() => open({ kind: "incidents", title: "Active incidents" })} />
            <StatCard icon={ShieldAlert} label="Security events" value={data?.kpis.securityEvents ?? 0} tone="warn" loading={isLoading} onClick={() => open({ kind: "alarms", category: "security", title: "Security alarms" })} />
            <StatCard icon={Crosshair} label="Threats blocked" value={data?.kpis.threatsBlocked ?? 0} tone="danger" loading={isLoading} />
            <StatCard icon={Cpu} label="Peak CPU" value={data?.kpis.peakCpu ?? 0} suffix="%" tone="warn" loading={isLoading} />
            <StatCard icon={Building2} label="Branches down" value={data?.kpis.branchesDown ?? 0} tone="danger" loading={isLoading} />
          </div>

          {/* Inventory + top critical alarms + incident summary */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 items-start">
            <Panel title="Device availability" icon={Boxes}>
              {isLoading ? <Skeleton className="h-[200px]" /> : (
                <>
                  <LokiChart type="pie" xKey="category" yKey="count" data={invChart} height={172} />
                  <div className="mt-2 space-y-1">
                    {(data?.inventory.categories ?? []).map((c) => (
                      <button key={c.category} onClick={() => open({ kind: "alarms", category: c.category, title: `${c.category} alarms` })}
                        className="w-full flex items-center justify-between text-[11px] px-1 py-0.5 rounded hover:bg-accent/40 transition-colors">
                        <span className="capitalize text-foreground/90">{c.category}</span>
                        <span className="font-semibold tabular-nums text-cyan-300">{c.count}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </Panel>

            <Panel title="Top critical alarms" icon={AlertOctagon} span="lg:col-span-2"
              action={<ViewAll onClick={() => open({ kind: "alarms", severity: "critical", title: "Critical alarms" })} />}>
              {isLoading ? <Skeleton className="h-[240px]" /> : (
                <AlarmTable alarms={(data?.topAlarms ?? []).slice(0, 7)} onDeviceClick={(d) => open({ kind: "device", id: d })} />
              )}
            </Panel>

            <Panel title="Incident summary" icon={AlertCircle}
              action={<ViewAll onClick={() => open({ kind: "incidents", title: "All incidents" })} />}>
              {isLoading ? <Skeleton className="h-[200px]" /> : incidentDonut.length === 0 ? (
                <p className="text-xs text-muted-foreground py-10 text-center">No incidents in this range.</p>
              ) : (
                <>
                  <LokiChart type="pie" xKey="severity" yKey="count" data={incidentDonut} height={172} />
                  <div className="mt-2 space-y-1">
                    {incidentDonut.map((s) => (
                      <button key={s.severity} onClick={() => open({ kind: "incidents", severity: s.severity, title: `${s.severity} incidents` })}
                        className="w-full flex items-center justify-between text-[11px] px-1 py-0.5 rounded hover:bg-accent/40 transition-colors">
                        <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${severityBadge(s.severity)}`}>{s.severity}</span>
                        <span className="font-semibold tabular-nums">{s.count}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </Panel>
          </div>

          {/* Alarm trend + recent incidents */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
            <Panel title="Alarm volume over time" icon={Activity} span="lg:col-span-2">
              {isLoading ? <Skeleton className="h-[220px]" /> : (
                <TimeSeriesChart rows={data!.alarmTrend.rows} keys={data!.alarmTrend.keys} type="area" stacked
                  colors={data!.alarmTrend.keys.map((k) => severityColor(k))} />
              )}
            </Panel>
            <Panel title="Recent incidents" icon={Siren}
              action={<ViewAll onClick={() => open({ kind: "incidents", title: "All incidents" })} />}>
              {isLoading ? <Skeleton className="h-[220px]" /> : (
                <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
                  {(data?.incidents.incidents ?? []).length === 0 && <p className="text-xs text-muted-foreground py-6 text-center">No incidents.</p>}
                  {(data?.incidents.incidents ?? []).slice(0, 8).map((inc, i) => (
                    <button key={inc.incident_id ?? i} onClick={() => inc.incident_id && open({ kind: "incident", id: inc.incident_id })}
                      className="w-full text-left rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5 hover:bg-accent/40 transition-colors">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${severityBadge(inc.severity)}`}>{inc.severity ?? "—"}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">{fmtAgo(inc.ts)}</span>
                      </div>
                      <p className="text-[11px] text-foreground/90 mt-1 leading-snug line-clamp-2">{inc.incident || inc.summary || inc.incident_id}</p>
                    </button>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          {/* Performance: top CPU / link / latency */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Panel title="Top CPU utilization" icon={Cpu}>
              {isLoading ? <Skeleton className="h-44" /> : <MetricBarList rows={data!.topCpu} metric="cpu_utilization_percent" onPick={(d) => open({ kind: "device", id: d })} />}
            </Panel>
            <Panel title="WAN / link utilization" icon={Network}>
              {isLoading ? <Skeleton className="h-44" /> : <MetricBarList rows={data!.topLink} metric="interface_utilization_percent" onPick={(d) => open({ kind: "device", id: d })} />}
            </Panel>
            <Panel title="Worst latency" icon={Timer}>
              {isLoading ? <Skeleton className="h-44" /> : <MetricBarList rows={data!.worstLatency} metric="latency_ms" onPick={(d) => open({ kind: "device", id: d })} />}
            </Panel>
          </div>

          {/* SOC threat feed: attacks blocked + origin countries + posture */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
            <Panel title="Attack types blocked" icon={Crosshair}>
              {isLoading ? <Skeleton className="h-[240px]" /> : (
                <LokiChart type="bar" xKey="attack_type" yKey="count"
                  data={(data?.attackTypes ?? []).map((a) => ({ attack_type: a.attack_type, count: a.count }))}
                  height={240} colors={["#f43f5e"]} />
              )}
            </Panel>
            <Panel title="Threats by origin country" icon={Globe}>
              {isLoading ? <Skeleton className="h-[240px]" /> : (
                <LokiChart type="bar" xKey="country" yKey="count"
                  data={(data?.threatsByCountry ?? []).map((c) => ({ country: c.country, count: c.count }))}
                  height={240} colors={["#f59e0b"]} />
              )}
            </Panel>
            <Panel title="Security posture" icon={ShieldAlert}>
              {isLoading ? <Skeleton className="h-[240px]" /> : (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-md border border-border/60 bg-background/40 px-2.5 py-2">
                      <div className="text-[11px] text-muted-foreground">Security alarms</div>
                      <div className="text-lg font-bold text-amber-400">{fmtNum(data?.kpis.securityEvents ?? 0)}</div>
                    </div>
                    <div className="rounded-md border border-border/60 bg-background/40 px-2.5 py-2">
                      <div className="text-[11px] text-muted-foreground">Threats blocked</div>
                      <div className="text-lg font-bold text-rose-400">{fmtNum(data?.kpis.threatsBlocked ?? 0)}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-foreground mb-1">Security alarms by severity</div>
                    {(data?.security.security_alarms_by_severity ?? []).length === 0 && <p className="text-[11px] text-muted-foreground">None in range.</p>}
                    {(data?.security.security_alarms_by_severity ?? []).map((s) => (
                      <div key={s.severity} className="flex items-center justify-between text-[11px] px-1 py-0.5">
                        <span className={`inline-block rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${severityBadge(s.severity)}`}>{s.severity}</span>
                        <span className="font-semibold tabular-nums">{fmtNum(s.count)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          </div>

          {/* Branch availability: geo map + per-branch health */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
            <Panel title="Branch network map" icon={Globe} span="lg:col-span-2">
              {isLoading ? <Skeleton className="h-[360px]" /> : (
                <GeoThreatMap points={data!.geo} metricLabel="critical alarms" emptyText="No branch geo data in range." />
              )}
            </Panel>
            <Panel title="Branch health" icon={Building2}>
              {isLoading ? <Skeleton className="h-[360px]" /> : (
                <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
                  {(data?.branches ?? []).length === 0 && <p className="text-xs text-muted-foreground py-6 text-center">No branch data.</p>}
                  {(data?.branches ?? []).map((b) => (
                    <div key={b.code} className="rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${b.status === "DOWN" ? "border-rose-500/40 text-rose-300 bg-rose-500/10" : "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"}`}>{b.status || "—"}</span>
                        <span className="text-[11px] font-medium text-foreground truncate flex-1">{b.branch || b.code}</span>
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0">{b.code}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[10px]">
                        <span className="text-rose-300">critical <span className="font-semibold tabular-nums">{fmtNum(b.critical)}</span></span>
                        <span className="text-amber-300">warning <span className="font-semibold tabular-nums">{fmtNum(b.warning)}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          {/* Device fabric + alarms by category */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
            <Panel title="Device fabric" icon={Network}>
              {isLoading ? <Skeleton className="h-[340px]" /> : (
                <TopologyMap host="NOC fabric" nodes={topoNodes} onSelect={(cat) => open({ kind: "alarms", category: cat, title: `${cat} alarms` })} />
              )}
            </Panel>
            <Panel title="Alarms by category" icon={Gauge} span="lg:col-span-2">
              {isLoading ? <Skeleton className="h-[300px]" /> : (
                <LokiChart type="bar" xKey="category" yKey="count" data={(data?.eventsByCategory ?? []).map((c) => ({ category: c.category, count: c.count }))} height={300} />
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
