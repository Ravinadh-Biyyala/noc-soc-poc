// Security Operations Center (SOC) dashboard — the security deep-dive companion to
// the unified NOC/SOC overview. Reads the live Loki security feeds (fortisiem,
// sentinel, darknet, windows, firewall, edr) via the canonical soc_* NOC functions
// (src/lib/loki-soc.ts → /api/loki/noc/*) — the same functions the BI Companion
// chat calls, so the numbers always agree. Reached from the sidebar and from the
// SOC-related visuals on the main dashboard.

import { useState, useMemo, useRef } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShieldAlert, RefreshCw, AlertCircle, ExternalLink, Crosshair, Globe, Radar, Bug,
  Network, MonitorSmartphone, Cloud, Siren, Flame, Activity, ScrollText,
  Clock, ShieldCheck, TrendingUp,
} from "lucide-react";
import { useRegisterObservation } from "@/lib/chat-observer";
import { useNocUi, readVisualValues } from "@/lib/ui-bridge";
import { fetchSocDashboard } from "@/lib/loki-soc";
import { DASH_TIME_RANGES } from "@/lib/loki-dashboard";
import type { SocEventRow } from "@/lib/loki-noc";
import { fmtNum, fmtAgo, severityBadge, severityColor } from "@/lib/noc-format";
import TimeSeriesChart from "@/components/loki/TimeSeriesChart";
import LokiChart from "@/components/loki/LokiChart";
import RankList from "@/components/loki/RankList";
import ExplainButton from "@/components/loki/ExplainButton";

// SOC source → label + accent + icon (for the per-source severity strip).
const SOURCE_META: Record<string, { label: string; color: string; Icon: typeof ShieldAlert }> = {
  fortisiem: { label: "FortiSIEM", color: "#f43f5e", Icon: Radar },
  sentinel: { label: "Sentinel", color: "#38bdf8", Icon: Cloud },
  darknet: { label: "Darknet Intel", color: "#a78bfa", Icon: Bug },
  windows: { label: "Windows", color: "#22d3ee", Icon: MonitorSmartphone },
  firewall: { label: "Firewall", color: "#f59e0b", Icon: Network },
  edr: { label: "EDR", color: "#34d399", Icon: ShieldAlert },
};

// ── small building blocks ────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, tone = "default", loading, onClick, explain, explainTitle, explainHint }: {
  icon: typeof ShieldAlert; label: string; value: number; tone?: "default" | "danger" | "warn" | "ok"; loading?: boolean; onClick?: () => void;
  // `explain` (or explainTitle) → clicking sends the tile's on-screen value to chat.
  explain?: boolean; explainTitle?: string; explainHint?: string;
}) {
  const toneCls = tone === "danger" ? "text-rose-400" : tone === "warn" ? "text-amber-400" : tone === "ok" ? "text-emerald-400" : "text-cyan-300";
  const { explainVisual } = useNocUi();
  const ref = useRef<HTMLDivElement>(null);
  const handleClick = (explain || explainTitle)
    ? () => explainVisual(explainTitle ?? label, explainHint, readVisualValues(ref.current))
    : onClick;
  return (
    <Card ref={ref} className={`relative overflow-hidden ${handleClick ? "cursor-pointer hover:border-primary/50 transition-colors" : ""}`} onClick={handleClick}>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Icon className={`w-3.5 h-3.5 ${toneCls}`} /> {label}</div>
        {loading ? <Skeleton className="h-7 w-16 mt-1.5" /> : <div className={`text-2xl font-bold mt-0.5 ${toneCls}`}>{fmtNum(value)}</div>}
      </CardContent>
    </Card>
  );
}

// Posture KPI — supports a unit suffix (%, m) and a "cfg" badge for metrics that
// come from SOC tooling config rather than the Loki telemetry.
function PostureCard({ icon: Icon, label, value, suffix, tone = "default", configured, loading, onClick, explain, explainTitle, explainHint }: {
  icon: typeof ShieldAlert; label: string; value: number; suffix?: string;
  tone?: "default" | "danger" | "warn" | "ok"; configured?: boolean; loading?: boolean; onClick?: () => void;
  // `explain` (or explainTitle) → clicking sends the tile's on-screen value to chat.
  explain?: boolean; explainTitle?: string; explainHint?: string;
}) {
  const toneCls = tone === "danger" ? "text-rose-400" : tone === "warn" ? "text-amber-400" : tone === "ok" ? "text-emerald-400" : "text-cyan-300";
  const { explainVisual } = useNocUi();
  const ref = useRef<HTMLDivElement>(null);
  const handleClick = (explain || explainTitle)
    ? () => explainVisual(explainTitle ?? label, explainHint, readVisualValues(ref.current))
    : onClick;
  return (
    <Card ref={ref} className={`relative overflow-hidden ${handleClick ? "cursor-pointer hover:border-primary/50 transition-colors" : ""}`} onClick={handleClick}>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Icon className={`w-3.5 h-3.5 ${toneCls}`} /> <span className="truncate">{label}</span>
          {configured && <span className="ml-auto shrink-0 rounded border border-border px-1 text-[8px] uppercase tracking-wide text-muted-foreground/70" title="From SOC tooling config — not Loki telemetry">cfg</span>}
        </div>
        {loading ? <Skeleton className="h-7 w-16 mt-1.5" /> : (
          <div className={`text-2xl font-bold mt-0.5 ${toneCls}`}>{suffix ? `${value}${suffix}` : fmtNum(value)}</div>
        )}
      </CardContent>
    </Card>
  );
}

function Panel({ title, icon: Icon, children, action, className = "", explainHint }: {
  title: string; icon?: typeof ShieldAlert; children: React.ReactNode; action?: React.ReactNode; className?: string; explainHint?: string;
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

// A scrolling security log-stream table (per-source key fields).
function EventStream({ rows, columns, empty = "No events in range." }: {
  rows: SocEventRow[];
  columns: Array<{ key: keyof SocEventRow | string; label: string; w?: string; mono?: boolean }>;
  empty?: string;
}) {
  if (rows.length === 0) return <p className="text-[11px] text-muted-foreground py-6 text-center">{empty}</p>;
  const grid = columns.map((c) => c.w ?? "1fr").join(" ");
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="grid gap-2 px-3 py-1.5 border-b border-border text-[9px] font-semibold uppercase tracking-wider text-muted-foreground" style={{ gridTemplateColumns: grid }}>
        {columns.map((c) => <span key={String(c.key)}>{c.label}</span>)}
      </div>
      <div className="max-h-[320px] overflow-y-auto divide-y divide-border/40">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 px-3 py-1.5 text-[11px] items-center hover:bg-accent/30 transition-colors" style={{ gridTemplateColumns: grid }}>
            {columns.map((c) => {
              if (c.key === "severity") {
                return <span key={String(c.key)}><span className={`inline-block rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${severityBadge(r.severity)}`}>{r.severity || "—"}</span></span>;
              }
              if (c.key === "when") {
                return <span key="when" className="text-muted-foreground whitespace-nowrap">{fmtAgo(r.ts)}</span>;
              }
              const v = r[c.key as keyof SocEventRow];
              return <span key={String(c.key)} className={`truncate ${c.mono ? "font-mono text-foreground/90" : "text-foreground/80"}`} title={v == null ? "" : String(v)}>{v == null || v === "" ? "—" : String(v)}</span>;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function LokiSoc() {
  const [since, setSince] = useState("7d");
  const [, setLocation] = useLocation();
  const { explainVisual } = useNocUi();

  const { data, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: ["soc-dashboard", since],
    queryFn: () => fetchSocDashboard(since),
    placeholderData: keepPreviousData,
  });

  const k = data?.summary.kpis;
  const p = data?.posture;
  const sources = data?.summary.sources ?? [];

  useRegisterObservation(
    useMemo(() => ({
      label: "Security Operations (SOC)",
      kind: "other" as const,
      summary:
        `User is on the SOC dashboard (time range ${since}). Live security feeds: FortiSIEM, Microsoft Sentinel, ` +
        `Darknet threat-intel, Windows endpoint, Firewall, EDR. SIEM critical+high: ${k?.siem_critical_high ?? 0}, ` +
        `darknet IOCs: ${k?.darknet_iocs ?? 0}, sentinel alerts: ${k?.sentinel_alerts ?? 0}, ` +
        `windows alerts: ${k?.windows_alerts ?? 0}, firewall denies: ${k?.firewall_denies ?? 0}, ` +
        `threats blocked: ${k?.threats_blocked ?? 0}. Use soc_summary / soc_event_trend / soc_top_fields / ` +
        `soc_recent_events / attack_types / threats_by_country to answer.`,
      suggestions: [
        "What are the top MITRE techniques we're seeing?",
        "Show recent FortiSIEM critical & high alerts",
        "Where are blocked attacks coming from?",
        "Which attacker tactics are most common in Sentinel?",
      ],
    }), [since, k?.siem_critical_high, k?.darknet_iocs, k?.sentinel_alerts, k?.windows_alerts, k?.firewall_denies, k?.threats_blocked]),
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-rose-400" /> Security Operations Center
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Live threat detection across SIEM, cloud, endpoint, network &amp; darknet intel
            {data ? ` · ${fmtNum(data.summary.total)} events in range` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => setLocation("/loki-logs")}>
            <ExternalLink className="w-3.5 h-3.5" /> Explorer
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => refetch()}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
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
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <KpiCard icon={Siren} label="SIEM critical/high" value={k?.siem_critical_high ?? 0} tone="danger" loading={isLoading} explain />
            <KpiCard icon={Bug} label="Darknet IOCs" value={k?.darknet_iocs ?? 0} tone="warn" loading={isLoading} explain />
            <KpiCard icon={Cloud} label="Sentinel alerts" value={k?.sentinel_alerts ?? 0} tone="default" loading={isLoading} explain />
            <KpiCard icon={MonitorSmartphone} label="Windows alerts" value={k?.windows_alerts ?? 0} tone="warn" loading={isLoading} explain />
            <KpiCard icon={Network} label="Firewall denies" value={k?.firewall_denies ?? 0} tone="danger" loading={isLoading} explain />
            <KpiCard icon={ShieldAlert} label="EDR events" value={k?.edr_events ?? 0} tone="ok" loading={isLoading} explain />
            <KpiCard icon={Crosshair} label="Threats blocked" value={k?.threats_blocked ?? 0} tone="danger" loading={isLoading} explain />
          </div>

          {/* Executive posture & compliance. Real (Loki): security incidents,
              malicious indicators, firewall availability. "cfg" = sourced from SOC
              tooling config (MTTD/MTTR, patch/AV compliance, domain health). */}
          <div className="flex items-center gap-2 pt-1">
            <ShieldCheck className="w-4 h-4 text-emerald-300" />
            <h2 className="text-sm font-semibold text-foreground">Security posture &amp; compliance</h2>
            <span className="text-[11px] text-muted-foreground">“cfg” = from SOC tooling config (not Loki)</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <PostureCard icon={Activity} label="Security incidents" value={p?.security_incidents ?? 0} tone="danger" loading={isLoading} explain />
            <PostureCard icon={Clock} label="MTTD" value={p?.mttd_minutes ?? 0} suffix="m" tone="ok" configured loading={isLoading} explainTitle="MTTD (mean time to detect)" explainHint="This is a SOC posture metric from tooling config — explain what it measures." />
            <PostureCard icon={Clock} label="MTTR" value={p?.mttr_minutes ?? 0} suffix="m" tone="warn" configured loading={isLoading} explainTitle="MTTR (mean time to respond)" explainHint="This is a SOC posture metric from tooling config — explain what it measures." />
            <PostureCard icon={Bug} label="Malicious queries" value={p?.malicious_queries ?? 0} tone="warn" loading={isLoading} explain />
            <PostureCard icon={Network} label="Firewall availability" value={p?.firewall_availability_pct ?? 0} suffix="%" tone="ok" loading={isLoading} explainHint="Explain what firewall uptime/availability means." />
            <PostureCard icon={ShieldCheck} label="Patch compliance" value={p?.patch_compliance_pct ?? 0} suffix="%" tone="ok" configured loading={isLoading} explainHint="SOC posture metric from tooling config — explain what the coverage means." />
            <PostureCard icon={ShieldCheck} label="Antivirus compliance" value={p?.av_compliance_pct ?? 0} suffix="%" tone="ok" configured loading={isLoading} explainHint="SOC posture metric from tooling config — explain what the coverage means." />
            <PostureCard icon={Globe} label="Domain health" value={p?.domain_health_pct ?? 0} suffix="%" tone="ok" configured loading={isLoading} explainHint="SOC posture metric from tooling config — explain what it covers." />
          </div>

          {/* Per-source severity strip */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {sources.map((s) => {
              const meta = SOURCE_META[s.source] ?? { label: s.source, color: "#94a3b8", Icon: ShieldAlert };
              const Icon = meta.Icon;
              return (
                <Card key={s.source} className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={(e) => explainVisual(`${meta.label} security feed`, undefined, readVisualValues(e.currentTarget))}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground"><Icon className="w-3.5 h-3.5" style={{ color: meta.color }} /> {meta.label}</div>
                      <span className="text-xs font-bold tabular-nums" style={{ color: meta.color }}>{fmtNum(s.total)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.by_severity.slice(0, 4).map((b) => (
                        <span key={b.severity} className={`inline-block rounded border px-1 py-0.5 text-[9px] font-semibold uppercase ${severityBadge(b.severity)}`}>
                          {b.severity} {fmtNum(b.count)}
                        </span>
                      ))}
                      {s.by_severity.length === 0 && <span className="text-[10px] text-muted-foreground">no events</span>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {isLoading && sources.length === 0 && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[76px]" />)}
          </div>

          {/* Volume + trend */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Panel title="Event volume by source" icon={Activity} className="lg:col-span-2">
              {isLoading ? <Skeleton className="h-[220px]" /> : (
                <TimeSeriesChart rows={data?.trend.rows ?? []} keys={data?.trend.keys ?? []} type="area" stacked height={220}
                  legendNames={Object.fromEntries(Object.entries(SOURCE_META).map(([k, v]) => [k, v.label]))} />
              )}
            </Panel>
            <Panel title="Threat trends" icon={TrendingUp}>
              {isLoading ? <Skeleton className="h-[220px]" /> : (
                <LokiChart type="bar" xKey="time" yKey={data?.threatTrend.keys?.[0] ?? "threats"} data={data?.threatTrend.rows ?? []} height={220} colors={["#f43f5e"]} />
              )}
            </Panel>
          </div>

          {/* Threat landscape */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Panel title="Attacks blocked by type" icon={Flame}>
              {isLoading ? <Skeleton className="h-[240px]" /> : (
                <LokiChart type="bar" xKey="attack_type" yKey="count" height={240}
                  data={(data?.attackTypes ?? []).map((a) => ({ attack_type: a.attack_type, count: a.count }))} />
              )}
            </Panel>
            <Panel title="Top origin countries" icon={Globe}>
              {isLoading ? <Skeleton className="h-[240px]" /> : (
                <RankList color="#f43f5e" items={(data?.countries ?? []).slice(0, 10).map((c) => ({ value: c.country, count: c.count }))} empty="No geo-tagged threats in range." />
              )}
            </Panel>
            <Panel title="Security incidents" icon={Activity}
              action={<Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={() => setLocation("/loki-traces")}>Traces <ExternalLink className="w-3 h-3" /></Button>}>
              {isLoading ? <Skeleton className="h-[240px]" /> : (
                <div className="space-y-1 max-h-[240px] overflow-y-auto">
                  {(data?.securityIncidents ?? []).length === 0 && <p className="text-[11px] text-muted-foreground py-6 text-center">No security incidents in range.</p>}
                  {(data?.securityIncidents ?? []).map((inc, i) => (
                    <div key={inc.incident_id ?? i} className="flex items-center gap-2 text-[11px] px-1 py-1 border-b border-border/40">
                      <span className={`inline-block rounded border px-1 py-0.5 text-[9px] font-semibold uppercase ${severityBadge(inc.severity)}`}>{inc.severity ?? "—"}</span>
                      <span className="text-foreground/90 truncate flex-1">{inc.incident || inc.summary || inc.incident_id}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          {/* SIEM (FortiSIEM) deep dive */}
          <Panel title="FortiSIEM — SIEM threat detection" icon={Radar}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Top MITRE ATT&amp;CK techniques</p>
                {isLoading ? <Skeleton className="h-40" /> : <RankList color="#f43f5e" items={data?.mitre ?? []} />}
              </div>
              <div className="lg:col-span-2 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Critical &amp; high alert stream</p>
                {isLoading ? <Skeleton className="h-40" /> : (
                  <EventStream rows={data?.siemEvents ?? []} columns={[
                    { key: "when", label: "When", w: "70px" },
                    { key: "severity", label: "Sev", w: "70px" },
                    { key: "host", label: "Host", w: "90px", mono: true },
                    { key: "mitre_technique", label: "MITRE", w: "70px", mono: true },
                    { key: "message", label: "Detection", w: "1.6fr" },
                  ]} />
                )}
              </div>
            </div>
          </Panel>

          {/* Sentinel (cloud) */}
          <Panel title="Microsoft Sentinel — cloud security" icon={Cloud}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Attacker tactics</p>
                {isLoading ? <Skeleton className="h-40" /> : <RankList color="#38bdf8" items={data?.tactics ?? []} />}
              </div>
              <div className="lg:col-span-2 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recent cloud alerts</p>
                {isLoading ? <Skeleton className="h-40" /> : (
                  <EventStream rows={data?.sentinelEvents ?? []} columns={[
                    { key: "when", label: "When", w: "70px" },
                    { key: "severity", label: "Sev", w: "70px" },
                    { key: "user", label: "User", w: "1fr", mono: true },
                    { key: "country", label: "Geo", w: "50px" },
                    { key: "tactics", label: "Tactic", w: "1fr" },
                    { key: "message", label: "Alert", w: "1.6fr" },
                  ]} empty="No Sentinel alerts in range." />
                )}
              </div>
            </div>
          </Panel>

          {/* Darknet threat intel */}
          <Panel title="Darknet threat intelligence" icon={Bug}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Threat actors</p>
                {isLoading ? <Skeleton className="h-32" /> : <RankList color="#a78bfa" items={data?.threatActors ?? []} />}
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground pt-2">Indicator types</p>
                {isLoading ? <Skeleton className="h-24" /> : <RankList color="#a78bfa" items={data?.iocTypes ?? []} />}
              </div>
              <div className="lg:col-span-2 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">IOC feed</p>
                {isLoading ? <Skeleton className="h-40" /> : (
                  <EventStream rows={data?.darknetEvents ?? []} columns={[
                    { key: "when", label: "When", w: "70px" },
                    { key: "severity", label: "Sev", w: "70px" },
                    { key: "threat_actor", label: "Actor", w: "80px" },
                    { key: "ioc_value", label: "IOC", w: "1fr", mono: true },
                    { key: "platform", label: "Source", w: "90px" },
                    { key: "message", label: "Intel", w: "1.6fr" },
                  ]} empty="No darknet intel in range." />
                )}
              </div>
            </div>
          </Panel>

          {/* Endpoint + firewall */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Windows endpoint events" icon={MonitorSmartphone}>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Top Event IDs</p>
                  {isLoading ? <Skeleton className="h-40" /> : <RankList color="#22d3ee" items={(data?.winEvents ?? []).map((e) => ({ value: `EventID ${e.value}`, count: e.count }))} />}
                </div>
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Top processes</p>
                  {isLoading ? <Skeleton className="h-40" /> : <RankList color="#22d3ee" items={data?.winProcs ?? []} />}
                </div>
              </div>
            </Panel>
            <Panel title="Firewall activity" icon={Network}>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</p>
                  {isLoading ? <Skeleton className="h-40" /> : <RankList color="#f59e0b" items={data?.fwActions ?? []} />}
                </div>
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Top destination ports</p>
                  {isLoading ? <Skeleton className="h-40" /> : <RankList color="#f59e0b" items={(data?.fwPorts ?? []).map((p) => ({ value: `:${p.value}`, count: p.count }))} />}
                </div>
              </div>
            </Panel>
          </div>

          {/* Unified endpoint/network stream */}
          <Panel title="Recent endpoint &amp; network alerts" icon={ScrollText}
            action={<Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={() => setLocation("/loki-logs")}>Open in Explorer <ExternalLink className="w-3 h-3" /></Button>}>
            {isLoading ? <Skeleton className="h-40" /> : (
              <EventStream rows={data?.endpointEvents ?? []} columns={[
                { key: "when", label: "When", w: "70px" },
                { key: "source", label: "Source", w: "80px" },
                { key: "severity", label: "Sev", w: "70px" },
                { key: "host", label: "Host", w: "90px", mono: true },
                { key: "message", label: "Event", w: "2fr" },
              ]} />
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
