// Device health snapshot — latest CPU/interface/latency, open-alarm count, recent
// alarms and related incidents. Shared by the diagnosis drawer and the chat's
// getDeviceHealth render. A `children` slot lets the drawer inject a trend chart.

import { Server, AlarmClock, AlertOctagon } from "lucide-react";
import { metricTone, severityBadge, fmtAgo } from "@/lib/noc-format";
import { METRIC_LABELS, type DeviceHealth } from "@/lib/loki-noc";
import AlarmTable from "./AlarmTable";

function MetricTile({ metric, value }: { metric: string; value: number | null }) {
  const unit = metric === "latency_ms" ? "ms" : "%";
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-2 text-center">
      <div className="text-[10px] text-muted-foreground">{METRIC_LABELS[metric] ?? metric}</div>
      <div className={`text-lg font-bold ${metricTone(metric, value)}`}>
        {value == null ? "—" : `${value}${unit}`}
      </div>
    </div>
  );
}

export interface DeviceHealthCardProps {
  health: DeviceHealth;
  onIncidentClick?: (incidentId: string) => void;
  children?: React.ReactNode;
}

export default function DeviceHealthCard({ health, onIncidentClick, children }: DeviceHealthCardProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Server className="w-4 h-4 text-cyan-300" />
        <div>
          <div className="text-sm font-semibold text-foreground font-mono">{health.device_id}</div>
          <div className="text-[10px] text-muted-foreground">{[health.category, health.model].filter(Boolean).join(" · ") || "device"}</div>
        </div>
        <div className="ml-auto flex items-center gap-1 text-[11px] text-amber-300">
          <AlarmClock className="w-3.5 h-3.5" /> {health.open_alarms.toLocaleString()} alarms
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {Object.keys(METRIC_LABELS).map((m) => <MetricTile key={m} metric={m} value={health.metrics?.[m] ?? null} />)}
      </div>

      {children}

      {(health.related_incidents?.length ?? 0) > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground mb-1.5"><AlertOctagon className="w-3.5 h-3.5 text-rose-400" /> Related incidents</div>
          <div className="space-y-1">
            {health.related_incidents!.map((inc, i) => (
              <button
                key={inc.incident_id ?? i}
                onClick={() => inc.incident_id && onIncidentClick?.(inc.incident_id)}
                className="w-full text-left flex items-center gap-2 rounded border border-border/60 bg-background/40 px-2 py-1 hover:bg-accent/40 transition-colors"
              >
                <span className={`inline-block rounded border px-1 py-0.5 text-[9px] font-semibold uppercase ${severityBadge(inc.severity)}`}>{inc.severity ?? "—"}</span>
                <span className="text-[11px] text-foreground/90 truncate flex-1">{inc.incident || inc.summary || inc.incident_id}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="text-[11px] font-semibold text-foreground mb-1.5">Recent alarms</div>
        <AlarmTable alarms={(health.recent_alarms ?? []).map((a) => ({ ...a, ts: a.ts }))} compact />
      </div>
    </div>
  );
}
