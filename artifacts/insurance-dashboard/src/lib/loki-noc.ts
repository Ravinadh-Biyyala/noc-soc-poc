// Client for the backend NOC function registry (services/agents-py app/loki/noc.py),
// proxied by Express at /api/loki/noc/*. These canonical functions are the single
// source of truth shared by the dashboard AND the chat agent — so the dashboard
// never re-derives LogQL and the agent calls a named function instead of
// hallucinating queries.

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Run a canonical NOC function by name with params → structured result. */
export async function callNoc<T = Record<string, unknown>>(name: string, params: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${API_BASE}/api/loki/noc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error(detail.detail || detail.error || `NOC function "${name}" failed (${r.status})`);
  }
  return r.json();
}

export interface NocFunctionParam { name: string; type: string; required: boolean; description: string }
export interface NocFunctionSpec { name: string; description: string; params: NocFunctionParam[] }

/** The function specs (name/description/params) — used to ground the chat agent. */
export async function listNocFunctions(): Promise<NocFunctionSpec[]> {
  const r = await fetch(`${API_BASE}/api/loki/noc/functions`, { credentials: "include" });
  if (!r.ok) return [];
  const body = await r.json().catch(() => ({}));
  return Array.isArray(body.functions) ? body.functions : [];
}

// ── Result types (mirror app/loki/noc.py) ──────────────────────────────────

export interface CategoryCount { category: string; count: number }
export interface SeverityCount { severity: string; count: number }
export interface DeviceInventory { categories: CategoryCount[]; total: number }
export interface AlarmsBySeverity { severities: SeverityCount[]; total: number }

export interface AlarmRow {
  ts: number; alert_id?: string; device_id?: string; model?: string;
  category?: string; severity?: string; source?: string; status?: string; message?: string;
}
export interface TopAlarms { severity: string; count: number; alarms: AlarmRow[] }

export interface IncidentRow {
  ts: number; incident_id?: string; type?: string; severity?: string; incident?: string;
  summary?: string; source?: string; root_cause?: string; confidence?: number;
  affected_assets?: string[]; early_warning?: boolean;
}
export interface Incidents { count: number; incidents: IncidentRow[]; by_severity: SeverityCount[] }

export interface IncidentDetail {
  incident_id: string; incident?: string; summary?: string; severity?: string; type?: string; source?: string;
  affected_assets?: string[]; root_cause?: string; rca_summary?: string; confidence?: number;
  evidence?: string[]; recommendation?: string[]; escalation_team?: string; automatable?: boolean;
  early_warning?: Record<string, unknown> | null; raw_logs?: Array<{ agent: string; ts: number; line: string }>;
}

export interface EarlyWarning {
  ts: number; incident_id?: string; kind?: string; risk?: string; warning?: string;
  asset?: string; observed?: number; threshold?: number;
}
export interface EarlyWarnings { count: number; warnings: EarlyWarning[] }

export interface DeviceMetricRank { device_id: string; value: number }
export interface TopDevicesByMetric { metric: string; agg: string; devices: DeviceMetricRank[] }

export interface MetricSeries { name: string; values: Array<{ ts: number; value: number }> }
export interface MetricTrend { metric: string; agg: string; device_id: string | null; series: MetricSeries[] }

export interface DeviceHealth {
  device_id: string; category?: string; model?: string;
  metrics: Record<string, number | null>; open_alarms: number;
  recent_alarms: AlarmRow[]; related_incidents: IncidentRow[];
}

export interface AttackTypeCount { attack_type: string; count: number }
export interface CountryCount { country: string; count: number }

export interface SecurityEvents {
  security_alarms_by_severity: SeverityCount[]; security_alarms_total: number;
  threats_blocked: number; attack_types: AttackTypeCount[]; top_countries: CountryCount[];
}

export interface AttackTypes { types: AttackTypeCount[]; total: number }
export interface ThreatsByCountry { countries: CountryCount[]; total: number }

export interface BranchHealthItem {
  code: string; branch?: string; status: string; lat?: number; lon?: number;
  critical: number; warning: number; ts?: number;
}
export interface BranchHealth { branches: BranchHealthItem[]; total: number; down: number; up: number }

export interface AssetRow {
  name: string; type: string; ip: string | null; location: string | null;
  category: string | null; model: string | null; severity: string | null;
  status: "up" | "degraded" | "down"; alarms: number;
}
export interface AssetInventory {
  assets: AssetRow[];
  total: number; online: number; degraded: number; offline: number;
  availability_pct: number; by_type: Array<{ type: string; count: number }>;
}

export const METRIC_LABELS: Record<string, string> = {
  cpu_utilization_percent: "CPU %",
  interface_utilization_percent: "Link util %",
  latency_ms: "Latency (ms)",
};

// ── Tracing (waterfall) ─────────────────────────────────────────────────────

export interface TraceListItem {
  incident_id: string; type?: string; severity?: string; device_id?: string | null; title?: string; ts: number;
}
export interface RecentTraces {
  count: number;
  incidents: TraceListItem[];
  by_type: Array<{ type: string; count: number }>;
}

export type TraceSpanKind = "event" | "warning" | "diagnosis";
export interface TraceSpan {
  label: string; kind: TraceSpanKind; severity?: string | null; source?: string | null;
  message?: string; ts: number; offset_ms: number; duration_ms: number;
}
export interface IncidentTrace {
  incident_id: string; device_id?: string | null; incident?: string; severity?: string; type?: string;
  root_cause?: string; rca_summary?: string; confidence?: number; recommendation?: string[]; escalation_team?: string;
  evidence?: string[]; detected_at?: number; started_at: number; ended_at: number; duration_ms: number;
  span_count: number; spans: TraceSpan[]; summary?: string;
}
