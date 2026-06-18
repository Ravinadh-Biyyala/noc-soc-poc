// In-page slide-over for deep diagnosis. Opened by clicking a KPI / alarm /
// incident / device anywhere on the NOC dashboard. Supports internal drill
// navigation (incident → affected device → its related incident → …) with a back
// stack, all backed by the canonical NOC functions.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, AlertCircle, Workflow } from "lucide-react";
import { callNoc, type IncidentDetail, type DeviceHealth, type TopAlarms, type Incidents, type MetricTrend } from "@/lib/loki-noc";
import { seriesToTimeRows } from "@/lib/loki-dashboard";
import { severityBadge, fmtAgo } from "@/lib/noc-format";
import IncidentCard from "./IncidentCard";
import DeviceHealthCard from "./DeviceHealthCard";
import AlarmTable from "./AlarmTable";
import TimeSeriesChart from "./TimeSeriesChart";

export type DrawerTarget =
  | { kind: "incident"; id: string }
  | { kind: "device"; id: string }
  | { kind: "alarms"; severity?: string; category?: string; title?: string }
  | { kind: "incidents"; severity?: string; title?: string };

function titleFor(t: DrawerTarget): string {
  switch (t.kind) {
    case "incident": return "Incident diagnosis";
    case "device": return "Device health";
    case "alarms": return t.title ?? "Alarms";
    case "incidents": return t.title ?? "Incidents";
  }
}

// ── per-view bodies ────────────────────────────────────────────────────────

function IncidentView({ id, onDevice }: { id: string; onDevice: (d: string) => void }) {
  const [, setLocation] = useLocation();
  const { data, isLoading, error } = useQuery({
    queryKey: ["noc-incident", id],
    queryFn: () => callNoc<IncidentDetail>("incident_detail", { incident_id: id }),
  });
  if (isLoading) return <Skeleton className="h-64" />;
  if (error) return <ErrorBox msg={(error as Error).message} />;
  return (
    <div className="space-y-2">
      <button
        onClick={() => setLocation(`/loki-traces?incident=${encodeURIComponent(id)}`)}
        className="flex items-center gap-1 text-[11px] text-primary hover:underline"
      >
        <Workflow className="w-3 h-3" /> View full trace →
      </button>
      <IncidentCard detail={data!} onAssetClick={onDevice} />
    </div>
  );
}

function DeviceView({ id, since, onIncident }: { id: string; since: string; onIncident: (i: string) => void }) {
  const health = useQuery({ queryKey: ["noc-device", id, since], queryFn: () => callNoc<DeviceHealth>("device_health", { device_id: id, since }) });
  const trend = useQuery({ queryKey: ["noc-device-trend", id, since], queryFn: () => callNoc<MetricTrend>("metric_trend", { metric: "cpu_utilization_percent", device_id: id, since }) });
  if (health.isLoading) return <Skeleton className="h-64" />;
  if (health.error) return <ErrorBox msg={(health.error as Error).message} />;
  const trendRows = trend.data ? seriesToTimeRows(trend.data.series.map((s) => ({ ...s, name: "CPU %" }))) : { rows: [], keys: [] };
  return (
    <DeviceHealthCard health={health.data!} onIncidentClick={onIncident}>
      {trendRows.rows.length > 0 && (
        <div className="rounded-md border border-border/60 bg-background/40 p-2">
          <div className="text-[11px] font-semibold text-foreground mb-1">CPU utilization trend</div>
          <TimeSeriesChart rows={trendRows.rows} keys={trendRows.keys} type="area" height={150} colors={["#22d3ee"]} />
        </div>
      )}
    </DeviceHealthCard>
  );
}

function AlarmsView({ t, since, onDevice }: { t: Extract<DrawerTarget, { kind: "alarms" }>; since: string; onDevice: (d: string) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["noc-alarms-list", t.severity, t.category, since],
    queryFn: () => callNoc<TopAlarms>("top_alarms", { since, severity: t.severity, category: t.category, limit: 50 }),
  });
  if (isLoading) return <Skeleton className="h-64" />;
  if (error) return <ErrorBox msg={(error as Error).message} />;
  return <AlarmTable alarms={data!.alarms} onDeviceClick={onDevice} />;
}

function IncidentsView({ t, since, onIncident }: { t: Extract<DrawerTarget, { kind: "incidents" }>; since: string; onIncident: (i: string) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["noc-incidents-list", t.severity, since],
    queryFn: () => callNoc<Incidents>("incidents", { since, severity: t.severity, limit: 50 }),
  });
  if (isLoading) return <Skeleton className="h-64" />;
  if (error) return <ErrorBox msg={(error as Error).message} />;
  const incidents = data!.incidents;
  if (incidents.length === 0) return <p className="text-xs text-muted-foreground py-6 text-center">No incidents in this range.</p>;
  return (
    <div className="space-y-1.5">
      {incidents.map((inc, i) => (
        <button key={inc.incident_id ?? i} onClick={() => inc.incident_id && onIncident(inc.incident_id)}
          className="w-full text-left rounded-md border border-border/60 bg-background/40 px-2.5 py-2 hover:bg-accent/40 transition-colors">
          <div className="flex items-center gap-2">
            <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${severityBadge(inc.severity)}`}>{inc.severity ?? "—"}</span>
            {inc.type && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{inc.type}</span>}
            <span className="ml-auto text-[10px] text-muted-foreground">{fmtAgo(inc.ts)}</span>
          </div>
          <p className="text-[11px] text-foreground/90 mt-1 leading-snug">{inc.incident || inc.summary || inc.incident_id}</p>
        </button>
      ))}
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground"><AlertCircle className="w-5 h-5 text-rose-500" /><p className="text-xs">{msg}</p></div>;
}

// ── drawer shell with back stack ────────────────────────────────────────────

export default function DiagnosisDrawer({ target, since, onClose }: { target: DrawerTarget | null; since: string; onClose: () => void }) {
  const [stack, setStack] = useState<DrawerTarget[]>([]);
  // Reset the navigation stack whenever the dashboard opens a new target.
  useEffect(() => { if (target) setStack([target]); }, [target]);

  const current = stack[stack.length - 1] ?? null;
  const push = (t: DrawerTarget) => setStack((s) => [...s, t]);
  const back = () => setStack((s) => s.slice(0, -1));

  const open = target != null && stack.length > 0;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="space-y-0">
          <div className="flex items-center gap-2">
            {stack.length > 1 && (
              <button onClick={back} className="text-muted-foreground hover:text-foreground" aria-label="Back"><ChevronLeft className="w-4 h-4" /></button>
            )}
            <SheetTitle className="text-sm">{current ? titleFor(current) : ""}</SheetTitle>
          </div>
        </SheetHeader>
        <div className="mt-3">
          {current?.kind === "incident" && <IncidentView id={current.id} onDevice={(d) => push({ kind: "device", id: d })} />}
          {current?.kind === "device" && <DeviceView id={current.id} since={since} onIncident={(i) => push({ kind: "incident", id: i })} />}
          {current?.kind === "alarms" && <AlarmsView t={current} since={since} onDevice={(d) => push({ kind: "device", id: d })} />}
          {current?.kind === "incidents" && <IncidentsView t={current} since={since} onIncident={(i) => push({ kind: "incident", id: i })} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
